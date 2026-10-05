-- Restaurant kiosk and onboarding emails.
--
-- Each restaurant gets a secret kiosk link (/kiosk/<token>) for a counter tablet. The kiosk is not
-- signed in: the server checks the token and acts for that restaurant with the functions below, which
-- only the server (service role) can call. Owners see and reset their link in the Partner Portal.
--
-- restaurant_emails records which onboarding emails were sent (application pending, welcome), so each
-- goes out once. approved_at is when Last Bite first approved the restaurant (it countersigns the
-- Partner Agreement then).

create table public.restaurant_kiosks (
  restaurant_id bigint primary key references public.restaurants (id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.restaurant_kiosks enable row level security;
revoke insert, update, delete, truncate on public.restaurant_kiosks from anon, authenticated;
create policy "owners and admins read kiosk links" on public.restaurant_kiosks for select to authenticated
  using (restaurant_id = (select public.my_restaurant_id()) or (select public.is_admin()));

create table public.restaurant_emails (
  restaurant_id bigint not null references public.restaurants (id) on delete cascade,
  kind text not null check (kind in ('pending', 'welcome')),
  sent_at timestamptz not null default now(),
  primary key (restaurant_id, kind)
);
alter table public.restaurant_emails enable row level security;
revoke all on public.restaurant_emails from anon, authenticated;
-- No policies: only the server reads or writes it.

alter table public.restaurants add column approved_at timestamptz;
update public.restaurants set approved_at = created_at where status = 'approved' and approved_at is null;

-- ---------------------------------------------------------------- pickups by restaurant id

-- restaurant_find_pickup / restaurant_begin_pickup for a given restaurant (the kiosk). Same rules:
-- 15 wrong PINs in 10 minutes locks lookups.
create function public._find_pickup(p_restaurant_id bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid bigint := p_restaurant_id;
  o public.orders;
begin
  if rid is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  if (select count(*) from public.pin_failures where restaurant_id = rid and at > now() - interval '10 minutes') >= 15 then
    raise exception 'Too many incorrect PINs. Please wait 10 minutes.' using errcode = 'BB429';
  end if;
  if coalesce(p_pin, '') !~ '^\d{4}$' then
    raise exception 'Enter the 4-digit PIN.' using errcode = 'BB400';
  end if;
  select o2.* into o from public.order_pins p join public.orders o2 on o2.id = p.order_id
    where p.restaurant_id = rid and p.pin = p_pin and p.active and o2.status = 'reserved';
  if not found then
    insert into public.pin_failures (restaurant_id) values (rid);
    return null;
  end if;
  return public._pickup_json(o);
end;
$$;

create function public._begin_pickup(p_restaurant_id bigint, p_pin text, p_order_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  found_order jsonb := public._find_pickup(p_restaurant_id, p_pin);
  v public.orders;
begin
  if found_order is null then
    raise exception 'No order awaiting pickup matches that PIN.' using errcode = 'BB404';
  end if;
  if (found_order ->> 'id')::bigint <> p_order_id then
    raise exception 'PIN does not match this order.' using errcode = 'BB409';
  end if;
  update public.orders set capture_started_at = now()
    where id = p_order_id and status = 'reserved'
      and (capture_started_at is null or capture_started_at < now() - interval '5 minutes')
    returning * into v;
  if not found then
    raise exception 'This order is already being processed.' using errcode = 'BB409';
  end if;
  return public._pickup_json(v) || jsonb_build_object('paymentRef', v.payment_ref, 'destinationAccount', v.destination_account);
end;
$$;

-- The signed-in owner's versions now use the shared ones.
create or replace function public.restaurant_find_pickup(p_pin text) returns jsonb
language sql security definer set search_path = public as $$
  select public._find_pickup(public.my_restaurant_id(), p_pin);
$$;

create or replace function public.restaurant_begin_pickup(p_pin text, p_order_id bigint) returns jsonb
language sql security definer set search_path = public as $$
  select public._begin_pickup(public.my_restaurant_id(), p_pin, p_order_id);
$$;

-- ---------------------------------------------------------------- offers by restaurant id

-- restaurant_save_offer (20261004000100_restaurant_subscriptions.sql) for a given restaurant.
create function public._save_offer(
  p_restaurant_id bigint, p_offer_id bigint, p_menu_item_id bigint, p_reason public.offer_reason, p_description text,
  p_discount_pct integer, p_quantity integer, p_expires_in_minutes integer
) returns public.offers
language plpgsql security definer set search_path = public as $$
declare
  rid bigint := p_restaurant_id;
  r_status public.restaurant_status;
  item public.menu_items;
  existing public.offers;
  v public.offers;
  v_start timestamptz;
  v_end timestamptz;
  committed integer := 0;
  v_description text;
begin
  if rid is null then
    raise exception 'Restaurant profile not found.' using errcode = 'BB404';
  end if;
  select status into r_status from public.restaurants where id = rid;
  if p_offer_id is not null then
    select * into existing from public.offers where id = p_offer_id and restaurant_id = rid for update;
    if existing.id is null then
      raise exception 'Offer not found.' using errcode = 'BB404';
    end if;
    if existing.status = 'ended' then
      raise exception 'Ended offers cannot be edited.' using errcode = 'BB409';
    end if;
    committed := existing.quantity_total - existing.quantity_available;
  elsif r_status = 'suspended' then
    raise exception 'Your restaurant is suspended, so you cannot post offers. Please contact Last Bite support.' using errcode = 'BB403';
  elsif not public.subscription_active(rid) then
    raise exception 'Your Last Bite subscription is not active. Renew it in the Subscription tab to post offers.' using errcode = 'BB402';
  end if;

  select * into item from public.menu_items where id = p_menu_item_id and restaurant_id = rid and active;
  if item.id is null then
    raise exception 'Menu item not found.' using errcode = 'BB404';
  end if;
  if p_reason is null then
    raise exception 'Please choose why this food is available.' using errcode = 'BB400';
  end if;
  if p_discount_pct is null or p_discount_pct < 1 or p_discount_pct > 90 then
    raise exception 'Discount must be a whole number from 1 to 90.' using errcode = 'BB400';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 500 then
    raise exception 'Quantity must be a whole number from 1 to 500.' using errcode = 'BB400';
  end if;
  if p_quantity < committed then
    raise exception '% already ordered, so quantity cannot be lower than that.', committed using errcode = 'BB400';
  end if;
  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'Description must be at most 500 characters.' using errcode = 'BB400';
  end if;

  if p_expires_in_minutes is not null then
    if p_expires_in_minutes < 5 or p_expires_in_minutes > 4320 then
      raise exception 'Discard timer (minutes) must be a whole number from 5 to 4320.' using errcode = 'BB400';
    end if;
    v_start := case when existing.id is not null and existing.pickup_start < now() then existing.pickup_start else now() end;
    v_end := now() + make_interval(mins => p_expires_in_minutes);
  elsif existing.id is not null then
    v_start := existing.pickup_start;
    v_end := existing.pickup_end;
  else
    raise exception 'Please set the discard timer.' using errcode = 'BB400';
  end if;

  v_description := coalesce(nullif(btrim(p_description), ''), item.description);

  if existing.id is null then
    insert into public.offers (restaurant_id, menu_item_id, image_url, title, description, reason, dietary,
      original_price_cents, discount_pct, quantity_total, quantity_available, pickup_start, pickup_end)
    values (rid, item.id, item.image_url, item.name, v_description, p_reason, item.dietary,
      item.price_cents, p_discount_pct, p_quantity, p_quantity, v_start, v_end)
    returning * into v;
  else
    -- Price changes only affect new orders; existing orders keep the price they were quoted.
    update public.offers set menu_item_id = item.id, image_url = item.image_url, title = item.name,
      description = v_description, reason = p_reason, dietary = item.dietary, original_price_cents = item.price_cents,
      discount_pct = p_discount_pct, quantity_total = p_quantity, quantity_available = p_quantity - committed,
      pickup_start = v_start, pickup_end = v_end
    where id = existing.id
    returning * into v;
    update public.orders set pickup_end = v_end where offer_id = v.id and status in ('pending_payment', 'reserved');
  end if;
  return v;
end;
$$;

create or replace function public.restaurant_save_offer(
  p_offer_id bigint, p_menu_item_id bigint, p_reason public.offer_reason, p_description text,
  p_discount_pct integer, p_quantity integer, p_expires_in_minutes integer
) returns public.offers
language sql security definer set search_path = public as $$
  select public._save_offer(public.my_restaurant_id(), p_offer_id, p_menu_item_id, p_reason, p_description,
    p_discount_pct, p_quantity, p_expires_in_minutes);
$$;

-- ---------------------------------------------------------------- access

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public._find_pickup(bigint, text)',
    'public._begin_pickup(bigint, text, bigint)',
    'public._save_offer(bigint, bigint, bigint, public.offer_reason, text, integer, integer, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

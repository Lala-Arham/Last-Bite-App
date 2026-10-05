'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteUser, grantSubscriptionYear, setRestaurantStatus } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { fmtDate, money, pct } from '@/lib/format';
import { day, run, useAdmin } from './shared';

type Row = {
  id: number; name: string; cuisine: string; address: string; city: string; zip: string; phone: string; status: 'pending' | 'approved' | 'suspended';
  adminNote: string; taxRateBps: number; createdAt: string; ownerEmail: string; ownerUsername: string; activeOffers: number; orders: number;
  foodCents: number; stripeReady: boolean; stripeAccount: string | null; subscriptionPaidThrough: string | null; subscriptionActive: boolean; ownerId: string; deleted: boolean;
};

export function RestaurantsPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const { data, isLoading } = useAdmin<Row[]>(['restaurants', status, q], 'restaurants', { status, q });
  const change = async (r: Row, next: Row['status']) => {
    const note = next === 'suspended' ? prompt(`Why are you suspending ${r.name}? (shown to the restaurant)`) : '';
    if (note === null) return;
    if (await run(() => setRestaurantStatus({ id: r.id, status: next, note }), `${r.name}: ${next}`)) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  const grant = async (r: Row) => {
    const reason = prompt(`Give ${r.name} a free subscription year? It starts when their current year ends. Reason (saved in the audit log):`);
    if (!reason) return;
    if (await run(() => grantSubscriptionYear({ restaurantId: r.id, note: reason }), `${r.name}: free year added`)) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  const subscription = (r: Row) => {
    const until = r.subscriptionPaidThrough;
    if (!until) return <Badge tone="amber">None</Badge>;
    return r.subscriptionActive
      ? <Badge tone="green">Until {fmtDate(until)}</Badge>
      : <Badge tone="red">Ended {fmtDate(until)}</Badge>;
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Search name, town, postal code or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="suspended">Suspended</option>
        </Select>
      </div>
      <Card className="p-2">
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <Table>
            <thead><tr><th>Restaurant</th><th>Owner</th><th>Activity</th><th>Subscription</th><th>Payouts</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><div className="text-xs text-muted">{r.cuisine} · {r.address}, {r.city} {r.zip} · tax {pct(r.taxRateBps)}</div>{r.adminNote && <div className="text-xs text-accent-ink">Note: {r.adminNote}</div>}</td>
                  <td className="text-sm">{r.ownerUsername}<div className="text-xs text-muted">{r.ownerEmail} · joined {day(r.createdAt)}</div></td>
                  <td className="text-sm">{r.activeOffers} live offers<div className="text-xs text-muted">{r.orders} orders · {money(r.foodCents)}</div></td>
                  <td>{subscription(r)}</td>
                  <td>{r.stripeReady ? <Badge tone="green">Stripe ready</Badge> : <Badge tone="amber">Not connected</Badge>}</td>
                  <td>{r.deleted ? <Badge tone="red">Deleted</Badge> : <StatusBadge status={r.status} label={r.status === 'pending' ? 'Pending approval' : undefined} />}</td>
                  <td className="whitespace-nowrap">
                    {!r.deleted && <div className="flex gap-1.5">
                      {r.status !== 'approved' && <Button size="sm" variant="green" onClick={() => change(r, 'approved')}>{r.status === 'pending' ? 'Approve' : 'Reinstate'}</Button>}
                      {r.status !== 'suspended' && <Button size="sm" variant="danger" onClick={() => change(r, 'suspended')}>Suspend</Button>}
                      <Button size="sm" variant="ghost" onClick={() => grant(r)}>Free year</Button>
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteFor(r)}>Delete</Button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        {deleteFor && <DeleteRestaurant r={deleteFor} onDone={() => { setDeleteFor(null); queryClient.invalidateQueries({ queryKey: ['admin'] }); }} />}
      </Dialog>
    </>
  );
}

// Deletes the restaurant and its owner's account (see deleteUser in src/app/actions/admin.ts).
function DeleteRestaurant({ r, onDone }: { r: Row; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  return (
    <DialogContent title={`Delete ${r.name}?`} description="This can't be undone.">
      <div className="mt-0 mb-4 grid gap-2 text-sm text-ink-2">
        <p className="m-0">The restaurant is taken off Last Bite and its owner&apos;s account ({r.ownerUsername}, {r.ownerEmail}) is deleted:</p>
        <ul className="m-0 grid gap-1 pl-5">
          <li>Live offers end, and orders waiting for pickup are cancelled (customers&apos; card holds are released).</li>
          <li>The kiosk link stops working and the owner can no longer log in.</li>
          <li>
            {r.orders > 0 || r.subscriptionPaidThrough
              ? 'Its sales, payouts and subscription invoices are kept for tax records; the owner\'s name, email and saved cards are erased.'
              : 'It has no sales or invoices, so the restaurant, menu, offers and account are removed completely.'}
          </li>
        </ul>
      </div>
      <Field label={`Type ${r.name} to confirm`} htmlFor="dr-confirm">
        <Input id="dr-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      </Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy || confirmText.trim().toLowerCase() !== r.name.toLowerCase()} onClick={async () => {
        setBusy(true);
        const res = await deleteUser({ id: r.ownerId });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(res.data.anonymized ? `${r.name} is deleted (sales and invoices kept)` : `${r.name} is deleted`);
        onDone();
      }}>Delete restaurant</Button>
    </DialogContent>
  );
}

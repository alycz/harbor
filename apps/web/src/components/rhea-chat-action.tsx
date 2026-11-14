import { RheaSupply } from './rhea-supply.tsx';

/** A proposed chat action is not approval: this only prefills the existing owner-signing flow.
 * The worker resolves asset identity, balances and gates again when Prepare is pressed.
 * A changed proposal remounts the form; durable pending plans are restored by owner identity.
 */
export function RheaChatAction({ assetId, amount }: { assetId: string; amount: string }) {
  return <RheaSupply key={`${assetId}:${amount}`} initialAssetId={assetId} initialAmount={amount} />;
}

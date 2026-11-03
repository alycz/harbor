import { z } from 'zod';

/** Each network has its own database; every row still names the network it belongs to. */
export const NETWORKS = ['mainnet', 'testnet'] as const;

export const NetworkSchema = z.enum(NETWORKS);

export type Network = z.infer<typeof NetworkSchema>;

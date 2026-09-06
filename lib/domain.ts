export interface Customer {
  userId: string;
  email?: string | null;
  displayName?: string | null;
  walletAddress?: string | null;
  balance: number;
  createdAt: string;
}

export interface StampEvent {
  id: number;
  userId: string;
  awardedBy: string;
  viaCode?: string | null;
  createdAt: string;
}

export interface CounterCodeBinding {
  code: string;
  userId: string;
  expiresAt: string;
}

export interface Identity {
  userId: string;
  email?: string | null;
  displayName?: string | null;
  walletAddress?: string | null;
}

export interface StampAward {
  mode: "customer-self" | "staff-customer";
  awarderUserId: string;
  customer: Customer;
  newBalance: number;
}

export const MAX_STAMPS_PER_CARD = 10;

export const FREE_LOAF_THRESHOLD = MAX_STAMPS_PER_CARD;

export interface MeResponse extends Identity {
  balance: number;
  stampCount: number;
  staff: boolean;
  createdAt?: string | null;
  freeLoafThreshold: number;
}

export interface CheckinResponse {
  code: string;
  expiresAt: string;
  ttlMinutes: number;
}

export interface AwardResponse {
  mode: "customer-self" | "staff-customer";
  balance: number;
  customer: Customer;
}

export interface StaffCustomersResponse {
  customers: Customer[];
  freeLoafThreshold: number;
  totalStamps: number;
  totalCustomers: number;
}
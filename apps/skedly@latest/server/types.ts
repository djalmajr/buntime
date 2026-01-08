export interface Appointment {
  id: string;
  userId?: string;
  startTime: number;
  endTime: number;
  status: string;
  totalAmount: number;
  openPixTransactionId?: string;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  address?: string;
  contact?: string;
  telegramToken?: string;
  payoutPixKey?: string;
  feeModel?: string;
}

export interface Service {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  intervalMinutes: number;
}

export interface Appointment {
  id: string;
  name: string;
  email: string;
  date: string;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  address?: string;
  contact?: string;
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

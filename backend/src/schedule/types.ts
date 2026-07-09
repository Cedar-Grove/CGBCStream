export type RecurrenceType = "weekly" | "once";

export interface ScheduleInput {
  title: string;
  recurrenceType: RecurrenceType;
  dayOfWeek?: number; // 0=Sunday..6=Saturday, required for weekly
  date?: string; // YYYY-MM-DD, required for once
  time: string; // HH:MM, 24h, server-local time
  durationMinutes: number;
  autoCreateYoutube: boolean;
  destinationIds: string[];
  active: boolean;
}

export interface SchedulePublic {
  id: string;
  title: string;
  recurrenceType: RecurrenceType;
  dayOfWeek: number | null;
  date: string | null;
  time: string;
  durationMinutes: number;
  autoCreateYoutube: boolean;
  destinationIds: string[];
  active: boolean;
  createdAt: string;
}

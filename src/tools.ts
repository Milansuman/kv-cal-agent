import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { db } from './db/index.js';
import { events, eventTypes, attendees, reminders, attendeeStatusEnum } from './db/schema.js';
import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';
import { detectConflicts } from './conflict.js';

// ============= CONFLICT DETECTION TOOL =============

export const checkEventConflicts = tool(
  async ({ startTime, endTime, excludeEventId }) => {
    try {
      const result = await detectConflicts(
        new Date(startTime),
        new Date(endTime),
        excludeEventId
      );
      
      return result.message;
    } catch (error) {
      return `Error checking conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'check_event_conflicts',
    description: 'Check for conflicting events in a given time range. Use this before creating or updating events to avoid scheduling conflicts.',
    schema: z.object({
      startTime: z.string().describe('Event start time (ISO 8601 format)'),
      endTime: z.string().describe('Event end time (ISO 8601 format)'),
      excludeEventId: z.number().optional().describe('Event ID to exclude from conflict check (useful when updating an event)'),
    }),
  }
);

// ============= EVENT TYPE TOOLS =============

export const createEventType = tool(
  async ({ name, color, description }) => {
    try {
      const [eventType] = await db.insert(eventTypes).values({ name, color, description }).returning();
      if (!eventType) {
        return 'Error: Failed to create event type';
      }
      return `Event type created: ${eventType.name} (${eventType.color})`;
    } catch (error) {
      return `Error creating event type: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'create_event_type',
    description: 'Create a new event type (meeting, party, workshop, etc.)',
    schema: z.object({
      name: z.string().describe('Event type name (e.g., "Meeting", "Party", "Workshop")'),
      color: z.string().describe('Hex color code (e.g., "#FF5733")'),
      description: z.string().optional().describe('Description of the event type'),
    }),
  }
);

export const listEventTypes = tool(
  async () => {
    try {
      const types = await db.select().from(eventTypes).orderBy(asc(eventTypes.name));
      
      if (types.length === 0) {
        return 'No event types found';
      }
      
      return types.map(t => `${t.id}: ${t.name} (${t.color})${t.description ? ` - ${t.description}` : ''}`).join('\n');
    } catch (error) {
      return `Error listing event types: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'list_event_types',
    description: 'List all available event types',
    schema: z.object({}),
  }
);

// ============= EVENT TOOLS =============

export const createEvent = tool(
  async ({ title, description, startTime, endTime, location, eventTypeId, isAllDay, isRecurring, recurrenceRule }) => {
    try {
      const [event] = await db.insert(events).values({
        title,
        description,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        location,
        eventTypeId,
        isAllDay: isAllDay ?? false,
        isRecurring: isRecurring ?? false,
        recurrenceRule,
      }).returning();
      
      if (!event) {
        return 'Error: Failed to create event';
      }
      
      return `Event created: "${event.title}" on ${event.startTime} (ID: ${event.id})`;
    } catch (error) {
      return `Error creating event: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event',
    schema: z.object({
      title: z.string().describe('Event title'),
      description: z.string().optional().describe('Event description'),
      startTime: z.string().describe('Event start time (ISO 8601 format)'),
      endTime: z.string().describe('Event end time (ISO 8601 format)'),
      location: z.string().optional().describe('Event location'),
      eventTypeId: z.number().describe('Event type ID'),
      isAllDay: z.boolean().optional().describe('Whether this is an all-day event'),
      isRecurring: z.boolean().optional().describe('Whether this event recurs'),
      recurrenceRule: z.string().optional().describe('Recurrence rule in iCalendar RRULE format'),
    }),
  }
);

export const getEvent = tool(
  async ({ eventId }) => {
    try {
      const [event] = await db.select()
        .from(events)
        .leftJoin(eventTypes, eq(events.eventTypeId, eventTypes.id))
        .where(eq(events.id, eventId))
        .limit(1);
      
      if (!event || !event.events) {
        return 'Event not found';
      }
      
      const eventAttendees = await db.select()
        .from(attendees)
        .where(eq(attendees.eventId, eventId));
      
      const attendeesList = eventAttendees.length > 0
        ? eventAttendees.map(a => 
            `  - ${a.name}${a.email ? ` (${a.email})` : ''} - ${a.status}`
          ).join('\n')
        : '  None';
      
      return `Event: ${event.events.title}
Type: ${event.event_types?.name ?? 'Unknown Type'}
Start: ${event.events.startTime}
End: ${event.events.endTime}
Location: ${event.events.location ?? 'N/A'}
All Day: ${event.events.isAllDay}
Recurring: ${event.events.isRecurring}
Description: ${event.events.description ?? 'N/A'}
Attendees:
${attendeesList}`;
    } catch (error) {
      return `Error getting event: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'get_event',
    description: 'Get detailed information about a specific event',
    schema: z.object({
      eventId: z.number().describe('Event ID'),
    }),
  }
);

export const listEvents = tool(
  async ({ startDate, endDate, eventTypeId }) => {
    try {
      let query = db.select().from(events);
      const conditions = [];
      
      if (startDate) {
        conditions.push(gte(events.startTime, new Date(startDate)));
      }
      if (endDate) {
        conditions.push(lte(events.endTime, new Date(endDate)));
      }
      if (eventTypeId) {
        conditions.push(eq(events.eventTypeId, eventTypeId));
      }
      
      const result = conditions.length > 0 
        ? await query.where(and(...conditions)).orderBy(asc(events.startTime))
        : await query.orderBy(asc(events.startTime));
      
      if (result.length === 0) {
        return 'No events found';
      }
      
      return result.map(e => 
        `${e.id}: ${e.title} | ${e.startTime} to ${e.endTime}${e.location ? ` | ${e.location}` : ''}`
      ).join('\n');
    } catch (error) {
      return `Error listing events: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'list_events',
    description: 'List events with optional filters',
    schema: z.object({
      startDate: z.string().optional().describe('Filter events starting after this date (ISO 8601)'),
      endDate: z.string().optional().describe('Filter events ending before this date (ISO 8601)'),
      eventTypeId: z.number().optional().describe('Filter by event type ID'),
    }),
  }
);

export const updateEvent = tool(
  async ({ eventId, title, description, startTime, endTime, location }) => {
    try {
      const updateData: any = {};
      if (title) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (startTime) updateData.startTime = new Date(startTime);
      if (endTime) updateData.endTime = new Date(endTime);
      if (location !== undefined) updateData.location = location;
      updateData.updatedAt = new Date();
      
      const [updated] = await db.update(events)
        .set(updateData)
        .where(eq(events.id, eventId))
        .returning();
      
      if (!updated) {
        return 'Error: Failed to update event or event not found';
      }
      
      return `Event updated: "${updated.title}"`;
    } catch (error) {
      return `Error updating event: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'update_event',
    description: 'Update an existing event',
    schema: z.object({
      eventId: z.number().describe('Event ID to update'),
      title: z.string().optional().describe('New event title'),
      description: z.string().optional().describe('New event description'),
      startTime: z.string().optional().describe('New start time (ISO 8601)'),
      endTime: z.string().optional().describe('New end time (ISO 8601)'),
      location: z.string().optional().describe('New location'),
    }),
  }
);

export const deleteEvent = tool(
  async ({ eventId }) => {
    try {
      await db.delete(events).where(eq(events.id, eventId));
      return `Event ${eventId} deleted successfully`;
    } catch (error) {
      return `Error deleting event: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'delete_event',
    description: 'Delete an event from the calendar',
    schema: z.object({
      eventId: z.number().describe('Event ID to delete'),
    }),
  }
);

// ============= ATTENDEE TOOLS =============

export const addAttendee = tool(
  async ({ eventId, name, email, status }) => {
    try {
      const [attendee] = await db.insert(attendees).values({
        eventId,
        name,
        email,
        status: status as any,
      }).returning();
      
      if (!attendee) {
        return 'Error: Failed to add attendee';
      }
      
      return `Attendee added: ${attendee.name}${attendee.email ? ` (${attendee.email})` : ''} to event ${eventId} with status: ${attendee.status}`;
    } catch (error) {
      return `Error adding attendee: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'add_attendee',
    description: 'Add an attendee to an event',
    schema: z.object({
      eventId: z.number().describe('Event ID'),
      name: z.string().describe('Attendee name'),
      email: z.string().optional().describe('Attendee email address'),
      status: z.enum(['pending', 'confirmed', 'tentative', 'declined']).optional().describe('Initial attendance status (default: pending)'),
    }),
  }
);

export const updateAttendeeStatus = tool(
  async ({ attendeeId, status, notes }) => {
    try {
      const updateData: any = {
        status: status as any,
        responseAt: new Date(),
      };
      if (notes !== undefined) updateData.notes = notes;
      
      const [updated] = await db.update(attendees)
        .set(updateData)
        .where(eq(attendees.id, attendeeId))
        .returning();
      
      if (!updated) {
        return 'Error: Failed to update attendee status or attendee not found';
      }
      
      return `Attendee status updated to: ${updated.status}`;
    } catch (error) {
      return `Error updating attendee status: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'update_attendee_status',
    description: 'Update an attendee\'s response status for an event',
    schema: z.object({
      attendeeId: z.number().describe('Attendee record ID'),
      status: z.enum(['pending', 'confirmed', 'tentative', 'declined']).describe('New attendance status'),
      notes: z.string().optional().describe('Optional notes from the attendee'),
    }),
  }
);

export const removeAttendee = tool(
  async ({ attendeeId }) => {
    try {
      await db.delete(attendees).where(eq(attendees.id, attendeeId));
      return `Attendee ${attendeeId} removed successfully`;
    } catch (error) {
      return `Error removing attendee: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'remove_attendee',
    description: 'Remove an attendee from an event',
    schema: z.object({
      attendeeId: z.number().describe('Attendee record ID to remove'),
    }),
  }
);

export const listEventAttendees = tool(
  async ({ eventId }) => {
    try {
      const eventAttendees = await db.select()
        .from(attendees)
        .where(eq(attendees.eventId, eventId));
      
      if (eventAttendees.length === 0) {
        return 'No attendees found for this event';
      }
      
      return eventAttendees.map(a => 
        `${a.id}: ${a.name}${a.email ? ` (${a.email})` : ''} - Status: ${a.status}${a.notes ? ` - Notes: ${a.notes}` : ''}`
      ).join('\n');
    } catch (error) {
      return `Error listing attendees: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'list_event_attendees',
    description: 'List all attendees for a specific event',
    schema: z.object({
      eventId: z.number().describe('Event ID'),
    }),
  }
);

// ============= REMINDER TOOLS =============

export const createReminder = tool(
  async ({ eventId, reminderTime }) => {
    try {
      const [reminder] = await db.insert(reminders).values({
        eventId,
        reminderTime: new Date(reminderTime),
      }).returning();
      
      if (!reminder) {
        return 'Error: Failed to create reminder';
      }
      
      return `Reminder created for event ${eventId} at ${reminder.reminderTime}`;
    } catch (error) {
      return `Error creating reminder: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'create_reminder',
    description: 'Create a reminder for an event',
    schema: z.object({
      eventId: z.number().describe('Event ID'),
      reminderTime: z.string().describe('When to send the reminder (ISO 8601 format)'),
    }),
  }
);

export const listReminders = tool(
  async ({ eventId, includeSet }) => {
    try {
      const conditions = [];
      if (eventId) conditions.push(eq(reminders.eventId, eventId));
      if (!includeSet) conditions.push(eq(reminders.sent, false));
      
      let query = db.select()
        .from(reminders)
        .leftJoin(events, eq(reminders.eventId, events.id))
        .orderBy(asc(reminders.reminderTime));
      
      const reminderList = conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;
      
      if (reminderList.length === 0) {
        return 'No reminders found';
      }
      
      return reminderList.map(r => 
        `${r.reminders.id}: Event "${r.events?.title ?? 'Unknown Event'}" at ${r.reminders.reminderTime} (Sent: ${r.reminders.sent})`
      ).join('\n');
    } catch (error) {
      return `Error listing reminders: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'list_reminders',
    description: 'List reminders with optional filters',
    schema: z.object({
      eventId: z.number().optional().describe('Filter by event ID'),
      includeSet: z.boolean().optional().describe('Include already sent reminders (default: false)'),
    }),
  }
);

export const markReminderSent = tool(
  async ({ reminderId }) => {
    try {
      await db.update(reminders)
        .set({ sent: true })
        .where(eq(reminders.id, reminderId));
      
      return `Reminder ${reminderId} marked as sent`;
    } catch (error) {
      return `Error marking reminder as sent: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  },
  {
    name: 'mark_reminder_sent',
    description: 'Mark a reminder as sent',
    schema: z.object({
      reminderId: z.number().describe('Reminder ID'),
    }),
  }
);

// Export all tools as an array for easy registration
export const allTools = [
  checkEventConflicts,
  createEventType,
  listEventTypes,
  createEvent,
  getEvent,
  listEvents,
  updateEvent,
  deleteEvent,
  addAttendee,
  updateAttendeeStatus,
  removeAttendee,
  listEventAttendees,
  createReminder,
  listReminders,
  markReminderSent,
];

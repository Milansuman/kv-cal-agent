import { Annotation, StateGraph, END } from '@langchain/langgraph';
import { db } from './db/index.js';
import { events } from './db/schema.js';
import { and, gte, lte, ne } from 'drizzle-orm';

// State for conflict detection
const ConflictState = Annotation.Root({
  startTime: Annotation<Date>,
  endTime: Annotation<Date>,
  excludeEventId: Annotation<number | undefined>,
  conflicts: Annotation<Array<{
    id: number;
    title: string;
    startTime: Date;
    endTime: Date;
    location: string | null;
  }>>,
  hasConflicts: Annotation<boolean>,
  message: Annotation<string>,
});

// Node to check for conflicts
async function checkConflicts(state: typeof ConflictState.State) {
  const { startTime, endTime, excludeEventId } = state;

  // Query for overlapping events
  // Events overlap if: event.start < newEvent.end AND event.end > newEvent.start
  const conditions = [
    gte(events.endTime, startTime),
    lte(events.startTime, endTime),
  ];

  // Exclude a specific event (useful when updating)
  if (excludeEventId) {
    conditions.push(ne(events.id, excludeEventId));
  }

  const conflictingEvents = await db
    .select({
      id: events.id,
      title: events.title,
      startTime: events.startTime,
      endTime: events.endTime,
      location: events.location,
    })
    .from(events)
    .where(and(...conditions));

  const hasConflicts = conflictingEvents.length > 0;
  
  let message = '';
  if (hasConflicts) {
    message = `⚠️  Found ${conflictingEvents.length} conflicting event(s):\n`;
    conflictingEvents.forEach((event) => {
      message += `  - "${event.title}" (${event.startTime.toLocaleString()} - ${event.endTime.toLocaleString()})`;
      if (event.location) {
        message += ` at ${event.location}`;
      }
      message += '\n';
    });
  } else {
    message = '✓ No conflicts found';
  }

  return {
    conflicts: conflictingEvents,
    hasConflicts,
    message,
  };
}

// Create the conflict detection subgraph
const conflictWorkflow = new StateGraph(ConflictState)
  .addNode('check', checkConflicts)
  .addEdge('__start__', 'check')
  .addEdge('check', END);

export const conflictDetectionGraph = conflictWorkflow.compile();

// Utility function to check for conflicts
export async function detectConflicts(
  startTime: Date,
  endTime: Date,
  excludeEventId?: number
): Promise<{
  hasConflicts: boolean;
  conflicts: Array<any>;
  message: string;
}> {
  const result = await conflictDetectionGraph.invoke({
    startTime,
    endTime,
    excludeEventId,
    conflicts: [],
    hasConflicts: false,
    message: '',
  });

  return {
    hasConflicts: result.hasConflicts,
    conflicts: result.conflicts,
    message: result.message,
  };
}

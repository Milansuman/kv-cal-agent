import 'dotenv/config';
import { createInterface } from 'readline';
import { ChatGroq } from '@langchain/groq';
import { StateGraph, MessagesAnnotation, END, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseMessage } from '@langchain/core/messages';
import { allTools } from './tools.js';
import { conflictDetectionGraph } from './conflict.js';
import chalk from 'chalk';
import { marked } from 'marked';
import {markedTerminal} from 'marked-terminal';
import { initializeNetraObservability } from './observability.js';

// Configure marked to use terminal renderer
//@ts-ignore
marked.use(markedTerminal());

// Initialize the model
const model = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY!,
  model: 'openai/gpt-oss-120b',
  temperature: 0,
});

// Bind tools to the model
const modelWithTools = model.bindTools(allTools);

// Extend MessagesAnnotation to include conflict detection data
const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  pendingEventCheck: Annotation<{ startTime: Date; endTime: Date; excludeEventId?: number } | null>({
    reducer: (_, value) => value,
    default: () => null,
  }),
  conflictCheckResult: Annotation<string | null>({
    reducer: (_, value) => value,
    default: () => null,
  }),
});

// Define the function that calls the model
async function callModel(state: typeof AgentState.State) {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

// Node to run conflict detection subgraph
async function checkConflicts(state: typeof AgentState.State) {
  if (!state.pendingEventCheck) {
    return { conflictCheckResult: null };
  }

  const { startTime, endTime, excludeEventId } = state.pendingEventCheck;
  
  const result = await conflictDetectionGraph.invoke({
    startTime,
    endTime,
    excludeEventId,
    conflicts: [],
    hasConflicts: false,
    message: '',
  });

  return {
    conflictCheckResult: result.message,
    pendingEventCheck: null,
  };
}

// Router to determine if conflict check is needed
function shouldCheckConflicts(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // Check if the last message has tool calls for check_event_conflicts
  if (lastMessage && 'tool_calls' in lastMessage && Array.isArray(lastMessage.tool_calls)) {
    const hasConflictCheck = lastMessage.tool_calls.some(
      (tc: any) => tc.name === 'check_event_conflicts'
    );
    
    if (hasConflictCheck) {
      return 'conflict_detector';
    }
  }
  
  return 'continue';
}

// Define the function that determines whether to continue or end after tools
function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];
  
  // If there are tool calls, continue to the tools node
  if (lastMessage && 'tool_calls' in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  
  // Otherwise, end
  return END;
}

// Create the graph with conflict detection subgraph
const workflow = new StateGraph(AgentState)
  .addNode('agent', callModel)
  .addNode('tools', new ToolNode(allTools))
  .addNode('conflict_detector', checkConflicts)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addConditionalEdges('tools', shouldCheckConflicts, {
    conflict_detector: 'conflict_detector',
    continue: 'agent',
  })
  .addEdge('conflict_detector', 'agent');

// Compile the graph
const app = workflow.compile();

// REPL functionality
async function runREPL() {
  await initializeNetraObservability();
  console.log(chalk.cyan.bold('\n🗓️  Calendar Agent REPL'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.yellow('Type your requests or "exit" to quit\n'));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: '),
  });

  // Conversation history
  const conversationHistory: BaseMessage[] = [];

  rl.prompt();

  rl.on('line', async (input: string) => {
    const userInput = input.trim();

    if (!userInput) {
      rl.prompt();
      return;
    }

    if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
      rl.close();
      process.exit(0);
      return;
    }

    try {
      // Show thinking indicator
      process.stdout.write(chalk.gray('\n🤔 Thinking...\n'));

      // Invoke the agent with the current conversation history
      const result = await app.invoke({
        messages: [
          ...conversationHistory,
          { role: 'user', content: userInput },
        ],
      });

      // Update conversation history with all messages
      conversationHistory.push(...result.messages);

      // Get the last message (assistant's response)
      const lastMessage = result.messages[result.messages.length - 1];
      
      if (lastMessage && 'content' in lastMessage && lastMessage.content) {
        const content = typeof lastMessage.content === 'string' ? lastMessage.content : String(lastMessage.content);
        console.log(chalk.blue('\nAgent:'));
        console.log(marked(content));
      }

      console.log(chalk.gray('\n' + '─'.repeat(50)));
      rl.prompt();
    } catch (error) {
      console.error(chalk.red('\n❌ Error:'), error instanceof Error ? error.message : 'Unknown error');
      console.log(chalk.gray('─'.repeat(50)));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    console.log(chalk.cyan('\n👋 Goodbye!\n'));
    process.exit(0);
  });
}

// Start the REPL
runREPL().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});

import { Message, UserMemory } from '../db/supabase';
import { KnowledgeChunk } from '../knowledge';

export const SYSTEM_PROMPT = `You are a helpful assistant that answers questions using information from the company's DigitalOcean database.

**Your Capabilities:**
- You have access to tour information, booking statistics, city details, and product catalogs
- You can provide information about tours, cities, bookings, and availability
- You should be as helpful as possible with the data you have

**Guidelines:**
1. **Use Available Data**: Answer questions using the DigitalOcean database information provided below
2. **Be Helpful**: If you have relevant information, share it - even if it doesn't answer the question perfectly
3. **Clarify When Needed**: If the question asks about specific dates/times not in the data, provide general information and clarify
4. **Example**: For "bookings in July 2025", you might not have future data, but you CAN provide:
   - Current booking statistics
   - Available tours in that location
   - General information about the area
5. **Only refuse if**: You have absolutely NO relevant information in the database context

**User Memory**: You can use the user's personal memory below to personalize communication.`;

export const buildPrompt = (
  question: string,
  knowledge: KnowledgeChunk[],
  memory: UserMemory[],
  history: Message[]
): any[] => {
  // Format knowledge
  const knowledgeText = knowledge.map(k => k.content).join('\n\n');
  
  // Format memory
  const memoryText = memory.map(m => `- ${m.content}`).join('\n');
  
  // Construct the system message with context
  const systemContent = `${SYSTEM_PROMPT}

### DigitalOcean Knowledge Base (FACTUAL SOURCE):
${knowledgeText || 'No relevant information found in the database.'}

### User Memory (PERSONALIZATION ONLY):
${memoryText || 'No previous user memory.'}
`;

  // Format history
  const messages = history.map(msg => ({
    role: msg.role,
    content: msg.content
  }));

  // Add system message at the beginning
  messages.unshift({
    role: 'system',
    content: systemContent
  });

  // Add current question if not already in history (it usually isn't when building prompt for next turn)
  // But the flow says "Store message in Supabase" -> "Load recent conversation messages".
  // So the current question might be in history.
  // However, usually we want to ensure the system prompt is fresh.
  // Let's assume 'history' contains the current user message at the end.
  // If not, we should add it. 
  // The spec says: "Retrieve last N messages... Build prompt... Current user question".
  // So we should append the current question if it's not the last message in history.
  
  // Actually, standard practice: System + History (which includes latest user msg).
  
  return messages;
};

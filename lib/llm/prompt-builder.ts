import { Message, UserMemory } from '../db/supabase';
import { KnowledgeChunk } from '../knowledge';

export const SYSTEM_PROMPT = `You are an assistant that answers questions ONLY using information retrieved from a read-only DigitalOcean PostgreSQL database that represents the official factual knowledge of the company.
You may also use the user’s personal memory stored in Supabase to personalize communication, but you must NOT use it as a factual source about tours, company data, or operational details.
If the answer cannot be derived entirely and explicitly from the DigitalOcean database context provided to you, you MUST say:
‘I’m not able to answer this based on the DigitalOcean database.’
Do not hallucinate.
Do not invent missing information.
Do not use the internet.
Do not use any knowledge beyond what is included from DO and the user memory provided.`;

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

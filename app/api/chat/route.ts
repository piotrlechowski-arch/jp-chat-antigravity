import { NextResponse } from 'next/server';
import { ConversationManager } from '@/lib/conversation';
import { MemoryManager } from '@/lib/memory';
import { DoPostgresKnowledgeSource } from '@/lib/knowledge';
import { LLMService } from '@/lib/llm';
import { buildPrompt } from '@/lib/llm/prompt-builder';

// Initialize services
const conversationManager = new ConversationManager();
const memoryManager = new MemoryManager();
const knowledgeSource = new DoPostgresKnowledgeSource();
const llmService = new LLMService();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, userId, conversationId } = body;

    if (!message || !userId) {
      return NextResponse.json({ error: 'Missing message or userId' }, { status: 400 });
    }

    // 1. Identify user (passed in body for now) & Get/Create Conversation
    // In a real app, userId would come from auth session
    let currentConversationId = conversationId;
    if (!currentConversationId) {
      const conv = await conversationManager.getOrCreateConversation(userId);
      if (!conv) {
        return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
      }
      currentConversationId = conv.id;
    }

    // 2. Store user message
    await conversationManager.storeMessage(currentConversationId, 'user', message);

    // 3. Retrieve context
    // - User Memory
    const userMemory = await memoryManager.fetchMemory(userId);
    // - Recent History
    const history = await conversationManager.fetchRecentMessages(currentConversationId);

    // 4. Query DO for relevant knowledge
    const knowledgeChunks = await knowledgeSource.search(message);

    // 5. Build Prompt
    const promptMessages = buildPrompt(message, knowledgeChunks, userMemory, history);

    // 6. Generate Answer
    const answer = await llmService.generateAnswer(promptMessages);

    // 7. Store Assistant Response
    await conversationManager.storeMessage(currentConversationId, 'assistant', answer);

    // 8. Update Memory (Async - fire and forget for response speed, or await if critical)
    // We'll await it to ensure it works for this demo, but usually this is a background job.
    const newFacts = await llmService.runMemoryExtractor([...history, { role: 'assistant', content: answer } as any]);
    await memoryManager.updateMemory(userId, newFacts);

    return NextResponse.json({
      answer,
      conversationId: currentConversationId,
      knowledgeUsed: knowledgeChunks.length > 0
    });

  } catch (error) {
    console.error('Error in chat API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

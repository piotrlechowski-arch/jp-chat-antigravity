import { NextResponse } from 'next/server';
import { ConversationManager } from '@/lib/conversation';

const conversationManager = new ConversationManager();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get('conversationId');

  if (!conversationId) {
    return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
  }

  try {
    const messages = await conversationManager.fetchRecentMessages(conversationId, 50);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error fetching history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

import { supabase, Message, Conversation } from '../db/supabase';

export class ConversationManager {
  async getOrCreateConversation(userId: string, threadId?: string): Promise<Conversation | null> {
    // If threadId is provided, try to find it
    if (threadId) {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', threadId)
        .single();
      
      if (data) return data;
    }

    // Ensure user exists first
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (!existingUser) {
      // Create user if doesn't exist
      const { error: userError } = await supabase
        .from('users')
        .insert({ id: userId });

      if (userError) {
        console.error('Error creating user:', userError);
        return null;
      }
    }

    // Otherwise create a new one
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: userId })
      .select()
      .single();

    if (error) {
      console.error('Error creating conversation:', error);
      return null;
    }

    return data;
  }

  async storeMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<Message | null> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content
      })
      .select()
      .single();

    if (error) {
      console.error('Error storing message:', error);
      return null;
    }

    return data;
  }

  async fetchRecentMessages(conversationId: string, limit: number = 10): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching messages:', error);
      return [];
    }

    // Reverse to get chronological order
    return (data || []).reverse();
  }
}

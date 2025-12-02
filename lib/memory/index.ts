import { supabase, UserMemory } from '../db/supabase';

export class MemoryManager {
  async fetchMemory(userId: string, limit: number = 5): Promise<UserMemory[]> {
    const { data, error } = await supabase
      .from('user_memory')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching user memory:', error);
      return [];
    }

    return data || [];
  }

  async updateMemory(userId: string, facts: string[]): Promise<void> {
    if (facts.length === 0) return;

    const memoryEntries = facts.map(fact => ({
      user_id: userId,
      content: fact,
      memory_type: 'fact',
      importance: 3, // Default importance
    }));

    const { error } = await supabase
      .from('user_memory')
      .insert(memoryEntries);

    if (error) {
      console.error('Error updating user memory:', error);
    }
  }
}

import OpenAI from 'openai';
import { Message } from '../db/supabase';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class LLMService {
  async generateAnswer(messages: any[]): Promise<string> {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o', // or gpt-3.5-turbo
        messages: messages,
        temperature: 0.1, // Low temperature for factual accuracy
      });

      return completion.choices[0].message.content || '';
    } catch (error) {
      console.error('Error generating answer from LLM:', error);
      return 'I apologize, but I encountered an error while processing your request.';
    }
  }

  async runMemoryExtractor(messages: Message[]): Promise<string[]> {
    // Extract last few messages for context
    const recentContext = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');

    const extractionPrompt = `Based on the following conversation, extract 0–5 short factual or preference-based statements about the user that would be useful to remember for future conversations. Return only NEW facts, not duplicates.
    
Conversation:
${recentContext}

Output format:
- Fact 1
- Fact 2
`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo', // Cheaper model for extraction
        messages: [
          { role: 'system', content: 'You are a helpful assistant that extracts user facts.' },
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.3,
      });

      const content = completion.choices[0].message.content || '';
      
      // Parse the output into an array of strings
      const facts = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- '))
        .map(line => line.substring(2));
        
      return facts;
    } catch (error) {
      console.error('Error extracting memory:', error);
      return [];
    }
  }
}

import { doQuery } from '../db/digitalocean';

export interface KnowledgeChunk {
  source: string;
  content: string;
  metadata?: any;
}

export interface KnowledgeSource {
  search(query: string): Promise<KnowledgeChunk[]>;
}

export class DoPostgresKnowledgeSource implements KnowledgeSource {
  
  // Map Polish city names (all cases) to English base form
  private normalizePolishCityName(word: string): string {
    const cityMap: { [key: string]: string } = {
      // Krakow variants
      'krakow': 'krakow', 'krakowie': 'krakow', 'krakowem': 'krakow', 'krakowa': 'krakow',
      // Warsaw variants  
      'warsaw': 'warsaw', 'warszawa': 'warsaw', 'warszawie': 'warsaw', 'warszawy': 'warsaw', 'warszawą': 'warsaw',
      // Gdansk variants
      'gdansk': 'gdansk', 'gdańsk': 'gdansk', 'gdanska': 'gdansk', 'gdańska': 'gdansk', 'gdansku': 'gdansk', 'gdańsku': 'gdansk',
      // Wroclaw variants
      'wroclaw': 'wroclaw', 'wrocław': 'wroclaw', 'wroclawia': 'wroclaw', 'wrocławia': 'wroclaw', 'wroclawiu': 'wroclaw', 'wrocławiu': 'wroclaw',
      // Poznan variants
      'poznan': 'poznan', 'poznań': 'poznan', 'poznania': 'poznan', 'poznaniu': 'poznan',
      // Hamburg variants (Polish spelling)
      'hamburg': 'hamburg', 'hamburgu': 'hamburg', 'hamburga': 'hamburg'
    };
    return cityMap[word.toLowerCase()] || word;
  }
  
  // Translate common Polish keywords to English
  private translatePolishKeyword(word: string): string[] {
    const translations: { [key: string]: string[] } = {
      // Tour-related
      'wycieczka': ['tour'], 'wycieczki': ['tour', 'tours'], 'wycieczkach': ['tour', 'tours'],
      'zwiedzanie': ['tour', 'visit'], 'zwiedzania': ['tour', 'visit'],
      // Product-related
      'produkt': ['product'], 'produkty': ['product', 'products'], 'produktach': ['product', 'products'],
      'oferta': ['offer', 'product'], 'oferty': ['offer', 'product'],
      // Article-related
      'artykul': ['article'], 'artykuly': ['article', 'articles'], 'artykulach': ['article', 'articles'],
      // Booking-related
      'rezerwacja': ['booking', 'reservation'], 'rezerwacje': ['booking', 'reservation'], 'rezerwacji': ['booking', 'reservation'],
      // Questions
      'jakie': [], 'jaki': [], 'jaka': [], // question words - remove
      'ile': ['how', 'many'], 'ilu': ['how', 'many'],
      'mamy': [], 'mam': [], 'ma': [] // "we have" - remove
    };
    return translations[word.toLowerCase()] || [word];
  }
  
  // Extract meaningful keywords from query by removing common words
  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'we', 'how', 'many', 'what', 'when',
      'where', 'who', 'which', 'this', 'that', 'these', 'those',
      // Polish stop words
      'w', 'o', 'z', 'do', 'na', 'i', 'czy', 'jak', 'jaki', 'jakie', 'mamy', 'mam'
    ]);
    
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    // Process each word: normalize cities, translate Polish keywords
    const processedKeywords: string[] = [];
    words.forEach(word => {
      // Try to normalize as city first
      const normalized = this.normalizePolishCityName(word);
      if (normalized !== word) {
        processedKeywords.push(normalized);
        return;
      }
      
      // Try to translate Polish keyword
      const translations = this.translatePolishKeyword(word);
      if (translations.length > 0) {
        processedKeywords.push(...translations);
      } else {
        // Keep original word if no translation
        processedKeywords.push(word);
      }
    });
    
    // Remove duplicates and limit to 5 keywords
    return [...new Set(processedKeywords)].slice(0, 5);
  }
  
  async search(query: string): Promise<KnowledgeChunk[]> {
    try {
      console.log('=== Knowledge Search Started ===');
      console.log('Query:', query);
      
      // Extract keywords for better matching
      const keywords = this.extractKeywords(query);
      console.log('Extracted keywords:', keywords);
      
      const results: KnowledgeChunk[] = [];
      
      // Build dynamic WHERE clause for keywords
      const buildKeywordConditions = (fields: string[]): string => {
        if (keywords.length === 0) return '1=1'; // No keywords, match all
        
        const conditions = keywords.map((_, idx) => {
          return fields.map(field => `${field} ILIKE $${idx + 1}`).join(' OR ');
        });
        return '(' + conditions.join(') OR (') + ')';
      };
      
      const keywordParams = keywords.map(kw => `%${kw}%`);
      
      // Strategy 1: Search products/tours by keywords
      const productFields = [
        'p.title_en', 'p.title',
        'p.short_description_en', 'p.short_description',
        'p.long_description_en', 'p.long_description',
        'c.name_en', 'c.name'
      ];
      
      const productSql = `
        SELECT 
          p.id,
          p.title_en,
          p.title,
          p.short_description_en,
          p.short_description,
          p.long_description_en,
          p.long_description,
          p.slug_en,
          p.slug,
          c.name_en as city_name,
          c.name as city_name_local
        FROM main.products_product p
        LEFT JOIN public.cities_city c ON p.city_id = c.id
        WHERE ${buildKeywordConditions(productFields)}
        LIMIT 10;
      `;
      
      const productResult = await doQuery(productSql, keywordParams);
      console.log('Product matches:', productResult.rows.length);
      
      productResult.rows.forEach((row: any) => {
        results.push({
          source: `Product: ${row.title_en || row.title}`,
          content: `**${row.title_en || row.title}**
Location: ${row.city_name || row.city_name_local || 'Unknown'}
Short Description: ${row.short_description_en || row.short_description || 'N/A'}
Full Description: ${(row.long_description_en || row.long_description || 'N/A').substring(0, 800)}`,
          metadata: {
            id: row.id,
            type: 'product',
            slug: row.slug_en || row.slug,
            city: row.city_name || row.city_name_local
          }
        });
      });

      // Strategy 2: Search cities  
      const cityFields = ['name_en', 'name', 'description_en', 'description', 'country'];
      const citySql = `
        SELECT 
          id,
          name_en,
          name,
          description_en,
          description,
          country,
          slug_en,
          slug
        FROM public.cities_city
        WHERE ${buildKeywordConditions(cityFields)}
        LIMIT 5;
      `;

      const cityResult = await doQuery(citySql, keywordParams);
      console.log('City matches:', cityResult.rows.length);

      cityResult.rows.forEach((row: any) => {
        results.push({
          source: `City: ${row.name_en || row.name}`,
          content: `**${row.name_en || row.name}**, ${row.country}
${(row.description_en || row.description || 'No description available').substring(0, 500)}`,
          metadata: {
            id: row.id,
            type: 'city',
            slug: row.slug_en || row.slug
          }
        });
      });

      // Strategy 3: Get booking statistics for matching products
      const statsFields = ['p.title_en', 'p.title', 'c.name_en', 'c.name'];
      const statsSql = `
        SELECT 
          p.id,
          p.title_en,
          p.title,
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT bi.id) as total_participants,
          COUNT(DISTINCT t.id) as total_tours
        FROM main.products_product p
        LEFT JOIN public.cities_city c ON p.city_id = c.id
        LEFT JOIN main.tours_tour t ON t.product_id = p.id
        LEFT JOIN main.bookings_booking b ON b.tour_id = t.id
        LEFT JOIN main.bookings_bookingitem bi ON bi.booking_id = b.id
        WHERE ${buildKeywordConditions(statsFields)}
        GROUP BY p.id, p.title_en, p.title
        HAVING COUNT(DISTINCT b.id) > 0
        ORDER BY total_bookings DESC
        LIMIT 5;
      `;

      const statsResult = await doQuery(statsSql, keywordParams);
      console.log('Stats matches:', statsResult.rows.length);

      statsResult.rows.forEach((row: any) => {
        results.push({
          source: `Booking Stats: ${row.title_en || row.title}`,
          content: `**Booking Statistics for "${row.title_en || row.title}"**
- Total Tours Scheduled: ${row.total_tours}
- Total Bookings: ${row.total_bookings}
- Total Participants: ${row.total_participants}`,
          metadata: {
            id: row.id,
            type: 'stats',
            bookings: row.total_bookings,
            participants: row.total_participants
          }
        });
      });

      // Strategy 4: If query seems like "list all", get a comprehensive list
      const lowerQuery = query.toLowerCase();
      if (lowerQuery.includes('list') || lowerQuery.includes('all') || lowerQuery.includes('available')) {
        const listSql = `
          SELECT 
            p.title_en,
            p.title,
            c.name_en as city_name,
            c.name as city_name_local
          FROM main.products_product p
          LEFT JOIN public.cities_city c ON p.city_id = c.id
          ORDER BY c.name_en, p.title_en
          LIMIT 50;
        `;
        
        const listResult = await doQuery(listSql, []);
        console.log('List all results:', listResult.rows.length);
        
        const groupedByCity: { [key: string]: string[] } = {};
        listResult.rows.forEach((row: any) => {
          const city = row.city_name || row.city_name_local || 'Other';
          if (!groupedByCity[city]) groupedByCity[city] = [];
          groupedByCity[city].push(row.title_en || row.title);
        });

        let listContent = '**Complete Tour List**\n\n';
        Object.entries(groupedByCity).forEach(([city, tours]) => {
          listContent += `**${city}:**\n`;
          tours.forEach(tour => listContent += `  - ${tour}\n`);
          listContent += '\n';
        });

        results.push({
          source: 'Complete Tour Catalog',
          content: listContent,
          metadata: { type: 'list', count: listResult.rows.length }
        });
      }

      console.log('Total knowledge chunks:', results.length);
      console.log('=== Knowledge Search Complete ===');
      
      return results;
      
    } catch (error) {
      console.error('Error searching DigitalOcean:', error);
      return [];
    }
  }
}

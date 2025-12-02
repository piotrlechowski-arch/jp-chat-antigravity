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
  async search(query: string): Promise<KnowledgeChunk[]> {
    try {
      console.log('=== Knowledge Search Started ===');
      console.log('Query:', query);
      
      const results: KnowledgeChunk[] = [];
      
      // Strategy 1: Always search products/tours by text
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
        WHERE 
          p.title_en ILIKE $1 OR
          p.title ILIKE $1 OR
          p.short_description_en ILIKE $1 OR
          p.short_description ILIKE $1 OR
          p.long_description_en ILIKE $1 OR
          p.long_description ILIKE $1 OR
          c.name_en ILIKE $1 OR
          c.name ILIKE $1
        LIMIT 10;
      `;
      
      const productResult = await doQuery(productSql, [`%${query}%`]);
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
        WHERE 
          name_en ILIKE $1 OR
          name ILIKE $1 OR
          description_en ILIKE $1 OR
          description ILIKE $1 OR
          country ILIKE $1
        LIMIT 5;
      `;

      const cityResult = await doQuery(citySql, [`%${query}%`]);
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
        WHERE 
          p.title_en ILIKE $1 OR
          p.title ILIKE $1 OR
          c.name_en ILIKE $1 OR
          c.name ILIKE $1
        GROUP BY p.id, p.title_en, p.title
        HAVING COUNT(DISTINCT b.id) > 0
        ORDER BY total_bookings DESC
        LIMIT 5;
      `;

      const statsResult = await doQuery(statsSql, [`%${query}%`]);
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

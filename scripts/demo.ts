import * as fs from 'fs';
import * as path from 'path';
import { searchCreators } from '../src/searchCreators';
import type { BrandProfile } from '../src/types';

/**
 * Runner to test the solution against the required hackathon parameter and output
 * the Top 10 RankedCreator[] final submission JSON file.
 */
async function runDemo() {
  console.log('Running search against projection engine...');

  const query = "Affordable home decor for small apartments";
  
  // Construct brand_smart_home profile based on hackathon schema
  const brand_smart_home: BrandProfile = {
    id: "brand_smart_home",
    industries: ["Home"],
    target_audience: {
      gender: "FEMALE",
      age_ranges: ["18-24", "25-34"]
    },
    gmv: 80000
  };

  try {
    const results = await searchCreators(query, brand_smart_home);

    console.log(`Successfully retrieved and ranked ${results.length} creators.`);

    // Write expected output format to file for submission
    const outputFile = path.join(__dirname, '..', 'submission_top10.json');
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf8');
    
    console.log(`✅ Saved top 10 results to ${outputFile}`);
    console.log('Ensure this file is uploaded in your participant portal!');
  } catch (error) {
    console.error('Error running search:', error);
  }
}

runDemo().catch(console.error);

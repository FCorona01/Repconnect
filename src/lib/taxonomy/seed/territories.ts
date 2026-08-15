/**
 * Territories — WHERE the work is.
 *
 * Structure: anywhere → country → region → subdivision → metro
 *
 * "Nationwide" and "Remote" are nodes in this tree, not separate concepts:
 *   - Nationwide (US) IS the `united-states` node, ancestor of every US state
 *     and metro, so selecting it already matches all of them.
 *   - Anywhere / Fully Remote IS the root, ancestor of everything.
 *
 * A separate "Remote" entry would be a second way to say the same thing, and
 * two vocabularies for one concept is what stops a marketplace from matching.
 * Whether the work is done from a desk or in the field is captured by
 * `sales_models` (Inside Sales vs Field / Outside Sales) — territory answers
 * WHERE, sales model answers HOW.
 *
 * KNOWN LIMITATION — multi-state metros
 * -------------------------------------
 * Several metros span state lines (New York NY-NJ-PA, Washington DC-VA-MD,
 * Kansas City MO-KS). Each is filed under its principal subdivision, so a rep
 * covering only New Jersey will not match a "New York Metro" opportunity
 * through the hierarchy alone. Reps in those markets normally select both the
 * metro and their state, which resolves it in practice. If this proves to bite,
 * the fix is an additive `territory_links` table for secondary containment —
 * no change to this structure.
 */

export type TerritoryKind = 'global' | 'country' | 'region' | 'subdivision' | 'metro';

export interface RegionSeed {
  slug: string;
  name: string;
}

export interface SubdivisionSeed {
  slug: string;
  name: string;
  iso: string;
  region: string;
  type: 'State' | 'District' | 'Province' | 'Territory';
}

export interface MetroSeed {
  slug: string;
  name: string;
  /** Principal subdivision slug. */
  subdivision: string;
}

export const ROOT = {
  slug: 'anywhere',
  name: 'Anywhere / Fully Remote',
} as const;

export const COUNTRIES = [
  { slug: 'united-states', name: 'United States (Nationwide)', iso: 'US' },
  { slug: 'canada', name: 'Canada (Nationwide)', iso: 'CA' },
] as const;

// --- United States ---------------------------------------------------------

export const US_REGIONS: RegionSeed[] = [
  { slug: 'us-northeast', name: 'Northeast' },
  { slug: 'us-midwest', name: 'Midwest' },
  { slug: 'us-south', name: 'South' },
  { slug: 'us-west', name: 'West' },
];

export const US_SUBDIVISIONS: SubdivisionSeed[] = [
  // Northeast
  { slug: 'connecticut', name: 'Connecticut', iso: 'CT', region: 'us-northeast', type: 'State' },
  { slug: 'maine', name: 'Maine', iso: 'ME', region: 'us-northeast', type: 'State' },
  { slug: 'massachusetts', name: 'Massachusetts', iso: 'MA', region: 'us-northeast', type: 'State' },
  { slug: 'new-hampshire', name: 'New Hampshire', iso: 'NH', region: 'us-northeast', type: 'State' },
  { slug: 'rhode-island', name: 'Rhode Island', iso: 'RI', region: 'us-northeast', type: 'State' },
  { slug: 'vermont', name: 'Vermont', iso: 'VT', region: 'us-northeast', type: 'State' },
  { slug: 'new-jersey', name: 'New Jersey', iso: 'NJ', region: 'us-northeast', type: 'State' },
  { slug: 'new-york', name: 'New York', iso: 'NY', region: 'us-northeast', type: 'State' },
  { slug: 'pennsylvania', name: 'Pennsylvania', iso: 'PA', region: 'us-northeast', type: 'State' },

  // Midwest
  { slug: 'illinois', name: 'Illinois', iso: 'IL', region: 'us-midwest', type: 'State' },
  { slug: 'indiana', name: 'Indiana', iso: 'IN', region: 'us-midwest', type: 'State' },
  { slug: 'michigan', name: 'Michigan', iso: 'MI', region: 'us-midwest', type: 'State' },
  { slug: 'ohio', name: 'Ohio', iso: 'OH', region: 'us-midwest', type: 'State' },
  { slug: 'wisconsin', name: 'Wisconsin', iso: 'WI', region: 'us-midwest', type: 'State' },
  { slug: 'iowa', name: 'Iowa', iso: 'IA', region: 'us-midwest', type: 'State' },
  { slug: 'kansas', name: 'Kansas', iso: 'KS', region: 'us-midwest', type: 'State' },
  { slug: 'minnesota', name: 'Minnesota', iso: 'MN', region: 'us-midwest', type: 'State' },
  { slug: 'missouri', name: 'Missouri', iso: 'MO', region: 'us-midwest', type: 'State' },
  { slug: 'nebraska', name: 'Nebraska', iso: 'NE', region: 'us-midwest', type: 'State' },
  { slug: 'north-dakota', name: 'North Dakota', iso: 'ND', region: 'us-midwest', type: 'State' },
  { slug: 'south-dakota', name: 'South Dakota', iso: 'SD', region: 'us-midwest', type: 'State' },

  // South
  { slug: 'delaware', name: 'Delaware', iso: 'DE', region: 'us-south', type: 'State' },
  { slug: 'district-of-columbia', name: 'District of Columbia', iso: 'DC', region: 'us-south', type: 'District' },
  { slug: 'florida', name: 'Florida', iso: 'FL', region: 'us-south', type: 'State' },
  { slug: 'georgia', name: 'Georgia', iso: 'GA', region: 'us-south', type: 'State' },
  { slug: 'maryland', name: 'Maryland', iso: 'MD', region: 'us-south', type: 'State' },
  { slug: 'north-carolina', name: 'North Carolina', iso: 'NC', region: 'us-south', type: 'State' },
  { slug: 'south-carolina', name: 'South Carolina', iso: 'SC', region: 'us-south', type: 'State' },
  { slug: 'virginia', name: 'Virginia', iso: 'VA', region: 'us-south', type: 'State' },
  { slug: 'west-virginia', name: 'West Virginia', iso: 'WV', region: 'us-south', type: 'State' },
  { slug: 'alabama', name: 'Alabama', iso: 'AL', region: 'us-south', type: 'State' },
  { slug: 'kentucky', name: 'Kentucky', iso: 'KY', region: 'us-south', type: 'State' },
  { slug: 'mississippi', name: 'Mississippi', iso: 'MS', region: 'us-south', type: 'State' },
  { slug: 'tennessee', name: 'Tennessee', iso: 'TN', region: 'us-south', type: 'State' },
  { slug: 'arkansas', name: 'Arkansas', iso: 'AR', region: 'us-south', type: 'State' },
  { slug: 'louisiana', name: 'Louisiana', iso: 'LA', region: 'us-south', type: 'State' },
  { slug: 'oklahoma', name: 'Oklahoma', iso: 'OK', region: 'us-south', type: 'State' },
  { slug: 'texas', name: 'Texas', iso: 'TX', region: 'us-south', type: 'State' },

  // West
  { slug: 'arizona', name: 'Arizona', iso: 'AZ', region: 'us-west', type: 'State' },
  { slug: 'colorado', name: 'Colorado', iso: 'CO', region: 'us-west', type: 'State' },
  { slug: 'idaho', name: 'Idaho', iso: 'ID', region: 'us-west', type: 'State' },
  { slug: 'montana', name: 'Montana', iso: 'MT', region: 'us-west', type: 'State' },
  { slug: 'nevada', name: 'Nevada', iso: 'NV', region: 'us-west', type: 'State' },
  { slug: 'new-mexico', name: 'New Mexico', iso: 'NM', region: 'us-west', type: 'State' },
  { slug: 'utah', name: 'Utah', iso: 'UT', region: 'us-west', type: 'State' },
  { slug: 'wyoming', name: 'Wyoming', iso: 'WY', region: 'us-west', type: 'State' },
  { slug: 'alaska', name: 'Alaska', iso: 'AK', region: 'us-west', type: 'State' },
  { slug: 'california', name: 'California', iso: 'CA', region: 'us-west', type: 'State' },
  { slug: 'hawaii', name: 'Hawaii', iso: 'HI', region: 'us-west', type: 'State' },
  { slug: 'oregon', name: 'Oregon', iso: 'OR', region: 'us-west', type: 'State' },
  { slug: 'washington', name: 'Washington', iso: 'WA', region: 'us-west', type: 'State' },
];

export const US_METROS: MetroSeed[] = [
  { slug: 'new-york-metro', name: 'New York Metro', subdivision: 'new-york' },
  { slug: 'buffalo-ny', name: 'Buffalo', subdivision: 'new-york' },
  { slug: 'rochester-ny', name: 'Rochester', subdivision: 'new-york' },
  { slug: 'albany-ny', name: 'Albany', subdivision: 'new-york' },
  { slug: 'syracuse-ny', name: 'Syracuse', subdivision: 'new-york' },
  { slug: 'los-angeles-metro', name: 'Los Angeles Metro', subdivision: 'california' },
  { slug: 'san-francisco-bay-area', name: 'San Francisco Bay Area', subdivision: 'california' },
  { slug: 'san-diego-ca', name: 'San Diego', subdivision: 'california' },
  { slug: 'sacramento-ca', name: 'Sacramento', subdivision: 'california' },
  { slug: 'riverside-ca', name: 'Inland Empire', subdivision: 'california' },
  { slug: 'san-jose-ca', name: 'San Jose & Silicon Valley', subdivision: 'california' },
  { slug: 'fresno-ca', name: 'Fresno', subdivision: 'california' },
  { slug: 'bakersfield-ca', name: 'Bakersfield', subdivision: 'california' },
  { slug: 'oxnard-ca', name: 'Oxnard & Ventura County', subdivision: 'california' },
  { slug: 'stockton-ca', name: 'Stockton', subdivision: 'california' },
  { slug: 'chicago-il', name: 'Chicago Metro', subdivision: 'illinois' },
  { slug: 'dallas-fort-worth-tx', name: 'Dallas–Fort Worth', subdivision: 'texas' },
  { slug: 'houston-tx', name: 'Houston', subdivision: 'texas' },
  { slug: 'san-antonio-tx', name: 'San Antonio', subdivision: 'texas' },
  { slug: 'austin-tx', name: 'Austin', subdivision: 'texas' },
  { slug: 'el-paso-tx', name: 'El Paso', subdivision: 'texas' },
  { slug: 'mcallen-tx', name: 'McAllen & Rio Grande Valley', subdivision: 'texas' },
  { slug: 'washington-dc-metro', name: 'Washington DC Metro', subdivision: 'district-of-columbia' },
  { slug: 'philadelphia-pa', name: 'Philadelphia Metro', subdivision: 'pennsylvania' },
  { slug: 'pittsburgh-pa', name: 'Pittsburgh', subdivision: 'pennsylvania' },
  { slug: 'harrisburg-pa', name: 'Harrisburg', subdivision: 'pennsylvania' },
  { slug: 'allentown-pa', name: 'Allentown & Lehigh Valley', subdivision: 'pennsylvania' },
  { slug: 'scranton-pa', name: 'Scranton & Wilkes-Barre', subdivision: 'pennsylvania' },
  { slug: 'miami-fl', name: 'Miami & South Florida', subdivision: 'florida' },
  { slug: 'tampa-fl', name: 'Tampa Bay', subdivision: 'florida' },
  { slug: 'orlando-fl', name: 'Orlando', subdivision: 'florida' },
  { slug: 'jacksonville-fl', name: 'Jacksonville', subdivision: 'florida' },
  { slug: 'cape-coral-fl', name: 'Fort Myers & Cape Coral', subdivision: 'florida' },
  { slug: 'north-port-fl', name: 'Sarasota & North Port', subdivision: 'florida' },
  { slug: 'lakeland-fl', name: 'Lakeland', subdivision: 'florida' },
  { slug: 'palm-bay-fl', name: 'Palm Bay & Melbourne', subdivision: 'florida' },
  { slug: 'deltona-fl', name: 'Daytona Beach & Deltona', subdivision: 'florida' },
  { slug: 'atlanta-ga', name: 'Atlanta Metro', subdivision: 'georgia' },
  { slug: 'augusta-ga', name: 'Augusta', subdivision: 'georgia' },
  { slug: 'boston-ma', name: 'Greater Boston', subdivision: 'massachusetts' },
  { slug: 'worcester-ma', name: 'Worcester', subdivision: 'massachusetts' },
  { slug: 'springfield-ma', name: 'Springfield', subdivision: 'massachusetts' },
  { slug: 'phoenix-az', name: 'Phoenix Metro', subdivision: 'arizona' },
  { slug: 'tucson-az', name: 'Tucson', subdivision: 'arizona' },
  { slug: 'detroit-mi', name: 'Detroit Metro', subdivision: 'michigan' },
  { slug: 'grand-rapids-mi', name: 'Grand Rapids', subdivision: 'michigan' },
  { slug: 'seattle-wa', name: 'Seattle Metro', subdivision: 'washington' },
  { slug: 'spokane-wa', name: 'Spokane', subdivision: 'washington' },
  { slug: 'minneapolis-mn', name: 'Minneapolis–St. Paul', subdivision: 'minnesota' },
  { slug: 'denver-co', name: 'Denver Metro', subdivision: 'colorado' },
  { slug: 'colorado-springs-co', name: 'Colorado Springs', subdivision: 'colorado' },
  { slug: 'baltimore-md', name: 'Baltimore', subdivision: 'maryland' },
  { slug: 'st-louis-mo', name: 'St. Louis', subdivision: 'missouri' },
  { slug: 'kansas-city-mo', name: 'Kansas City', subdivision: 'missouri' },
  { slug: 'charlotte-nc', name: 'Charlotte', subdivision: 'north-carolina' },
  { slug: 'raleigh-nc', name: 'Raleigh & Research Triangle', subdivision: 'north-carolina' },
  { slug: 'greensboro-nc', name: 'Greensboro & Winston-Salem', subdivision: 'north-carolina' },
  { slug: 'durham-nc', name: 'Durham & Chapel Hill', subdivision: 'north-carolina' },
  { slug: 'portland-or', name: 'Portland Metro', subdivision: 'oregon' },
  { slug: 'las-vegas-nv', name: 'Las Vegas', subdivision: 'nevada' },
  { slug: 'reno-nv', name: 'Reno', subdivision: 'nevada' },
  { slug: 'cincinnati-oh', name: 'Cincinnati', subdivision: 'ohio' },
  { slug: 'columbus-oh', name: 'Columbus', subdivision: 'ohio' },
  { slug: 'cleveland-oh', name: 'Cleveland', subdivision: 'ohio' },
  { slug: 'dayton-oh', name: 'Dayton', subdivision: 'ohio' },
  { slug: 'akron-oh', name: 'Akron', subdivision: 'ohio' },
  { slug: 'toledo-oh', name: 'Toledo', subdivision: 'ohio' },
  { slug: 'indianapolis-in', name: 'Indianapolis', subdivision: 'indiana' },
  { slug: 'nashville-tn', name: 'Nashville', subdivision: 'tennessee' },
  { slug: 'memphis-tn', name: 'Memphis', subdivision: 'tennessee' },
  { slug: 'knoxville-tn', name: 'Knoxville', subdivision: 'tennessee' },
  { slug: 'chattanooga-tn', name: 'Chattanooga', subdivision: 'tennessee' },
  { slug: 'virginia-beach-va', name: 'Virginia Beach & Hampton Roads', subdivision: 'virginia' },
  { slug: 'richmond-va', name: 'Richmond', subdivision: 'virginia' },
  { slug: 'providence-ri', name: 'Providence', subdivision: 'rhode-island' },
  { slug: 'milwaukee-wi', name: 'Milwaukee', subdivision: 'wisconsin' },
  { slug: 'madison-wi', name: 'Madison', subdivision: 'wisconsin' },
  { slug: 'oklahoma-city-ok', name: 'Oklahoma City', subdivision: 'oklahoma' },
  { slug: 'tulsa-ok', name: 'Tulsa', subdivision: 'oklahoma' },
  { slug: 'louisville-ky', name: 'Louisville', subdivision: 'kentucky' },
  { slug: 'new-orleans-la', name: 'New Orleans', subdivision: 'louisiana' },
  { slug: 'baton-rouge-la', name: 'Baton Rouge', subdivision: 'louisiana' },
  { slug: 'salt-lake-city-ut', name: 'Salt Lake City', subdivision: 'utah' },
  { slug: 'ogden-ut', name: 'Ogden', subdivision: 'utah' },
  { slug: 'provo-ut', name: 'Provo & Utah Valley', subdivision: 'utah' },
  { slug: 'hartford-ct', name: 'Hartford', subdivision: 'connecticut' },
  { slug: 'bridgeport-ct', name: 'Bridgeport & Fairfield County', subdivision: 'connecticut' },
  { slug: 'new-haven-ct', name: 'New Haven', subdivision: 'connecticut' },
  { slug: 'birmingham-al', name: 'Birmingham', subdivision: 'alabama' },
  { slug: 'huntsville-al', name: 'Huntsville', subdivision: 'alabama' },
  { slug: 'honolulu-hi', name: 'Honolulu', subdivision: 'hawaii' },
  { slug: 'omaha-ne', name: 'Omaha', subdivision: 'nebraska' },
  { slug: 'greenville-sc', name: 'Greenville & Upstate', subdivision: 'south-carolina' },
  { slug: 'charleston-sc', name: 'Charleston', subdivision: 'south-carolina' },
  { slug: 'columbia-sc', name: 'Columbia', subdivision: 'south-carolina' },
  { slug: 'albuquerque-nm', name: 'Albuquerque', subdivision: 'new-mexico' },
  { slug: 'boise-id', name: 'Boise', subdivision: 'idaho' },
  { slug: 'little-rock-ar', name: 'Little Rock', subdivision: 'arkansas' },
  { slug: 'des-moines-ia', name: 'Des Moines', subdivision: 'iowa' },
  { slug: 'wichita-ks', name: 'Wichita', subdivision: 'kansas' },
  { slug: 'jackson-ms', name: 'Jackson', subdivision: 'mississippi' },
  { slug: 'anchorage-ak', name: 'Anchorage', subdivision: 'alaska' },
  { slug: 'portland-me', name: 'Portland', subdivision: 'maine' },
  { slug: 'manchester-nh', name: 'Manchester & Nashua', subdivision: 'new-hampshire' },
  { slug: 'burlington-vt', name: 'Burlington', subdivision: 'vermont' },
  { slug: 'wilmington-de', name: 'Wilmington', subdivision: 'delaware' },
  { slug: 'charleston-wv', name: 'Charleston', subdivision: 'west-virginia' },
  { slug: 'billings-mt', name: 'Billings', subdivision: 'montana' },
  { slug: 'cheyenne-wy', name: 'Cheyenne', subdivision: 'wyoming' },
  { slug: 'fargo-nd', name: 'Fargo', subdivision: 'north-dakota' },
  { slug: 'sioux-falls-sd', name: 'Sioux Falls', subdivision: 'south-dakota' },
];

// --- Canada ----------------------------------------------------------------

export const CA_REGIONS: RegionSeed[] = [
  { slug: 'ca-atlantic', name: 'Atlantic Canada' },
  { slug: 'ca-central', name: 'Central Canada' },
  { slug: 'ca-prairies', name: 'Prairie Provinces' },
  { slug: 'ca-west-coast', name: 'West Coast' },
  { slug: 'ca-north', name: 'Northern Canada' },
];

export const CA_SUBDIVISIONS: SubdivisionSeed[] = [
  { slug: 'newfoundland-and-labrador', name: 'Newfoundland and Labrador', iso: 'NL', region: 'ca-atlantic', type: 'Province' },
  { slug: 'prince-edward-island', name: 'Prince Edward Island', iso: 'PE', region: 'ca-atlantic', type: 'Province' },
  { slug: 'nova-scotia', name: 'Nova Scotia', iso: 'NS', region: 'ca-atlantic', type: 'Province' },
  { slug: 'new-brunswick', name: 'New Brunswick', iso: 'NB', region: 'ca-atlantic', type: 'Province' },
  { slug: 'quebec', name: 'Quebec', iso: 'QC', region: 'ca-central', type: 'Province' },
  { slug: 'ontario', name: 'Ontario', iso: 'ON', region: 'ca-central', type: 'Province' },
  { slug: 'manitoba', name: 'Manitoba', iso: 'MB', region: 'ca-prairies', type: 'Province' },
  { slug: 'saskatchewan', name: 'Saskatchewan', iso: 'SK', region: 'ca-prairies', type: 'Province' },
  { slug: 'alberta', name: 'Alberta', iso: 'AB', region: 'ca-prairies', type: 'Province' },
  { slug: 'british-columbia', name: 'British Columbia', iso: 'BC', region: 'ca-west-coast', type: 'Province' },
  { slug: 'yukon', name: 'Yukon', iso: 'YT', region: 'ca-north', type: 'Territory' },
  { slug: 'northwest-territories', name: 'Northwest Territories', iso: 'NT', region: 'ca-north', type: 'Territory' },
  { slug: 'nunavut', name: 'Nunavut', iso: 'NU', region: 'ca-north', type: 'Territory' },
];

export const CA_METROS: MetroSeed[] = [
  { slug: 'toronto-on', name: 'Greater Toronto Area', subdivision: 'ontario' },
  { slug: 'ottawa-on', name: 'Ottawa', subdivision: 'ontario' },
  { slug: 'hamilton-on', name: 'Hamilton', subdivision: 'ontario' },
  { slug: 'kitchener-on', name: 'Kitchener–Waterloo', subdivision: 'ontario' },
  { slug: 'london-on', name: 'London', subdivision: 'ontario' },
  { slug: 'windsor-on', name: 'Windsor', subdivision: 'ontario' },
  { slug: 'oshawa-on', name: 'Oshawa & Durham Region', subdivision: 'ontario' },
  { slug: 'barrie-on', name: 'Barrie', subdivision: 'ontario' },
  { slug: 'guelph-on', name: 'Guelph', subdivision: 'ontario' },
  { slug: 'montreal-qc', name: 'Montreal', subdivision: 'quebec' },
  { slug: 'quebec-city-qc', name: 'Quebec City', subdivision: 'quebec' },
  { slug: 'sherbrooke-qc', name: 'Sherbrooke', subdivision: 'quebec' },
  { slug: 'gatineau-qc', name: 'Gatineau', subdivision: 'quebec' },
  { slug: 'vancouver-bc', name: 'Metro Vancouver', subdivision: 'british-columbia' },
  { slug: 'victoria-bc', name: 'Victoria', subdivision: 'british-columbia' },
  { slug: 'kelowna-bc', name: 'Kelowna & Okanagan', subdivision: 'british-columbia' },
  { slug: 'calgary-ab', name: 'Calgary', subdivision: 'alberta' },
  { slug: 'edmonton-ab', name: 'Edmonton', subdivision: 'alberta' },
  { slug: 'winnipeg-mb', name: 'Winnipeg', subdivision: 'manitoba' },
  { slug: 'saskatoon-sk', name: 'Saskatoon', subdivision: 'saskatchewan' },
  { slug: 'regina-sk', name: 'Regina', subdivision: 'saskatchewan' },
  { slug: 'halifax-ns', name: 'Halifax', subdivision: 'nova-scotia' },
  { slug: 'moncton-nb', name: 'Moncton', subdivision: 'new-brunswick' },
  { slug: 'st-johns-nl', name: "St. John's", subdivision: 'newfoundland-and-labrador' },
];

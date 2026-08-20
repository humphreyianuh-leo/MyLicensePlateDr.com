// Fill these in from your Supabase project: Settings -> API
// Project URL looks like https://xxxxxxxxxxxx.supabase.co
// The "anon public" key is safe to use here — Row Level Security in
// supabase-schema.sql is what actually protects user data.
const SUPABASE_URL = "https://wspoaaavafclfpdplcqv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzcG9hYWF2YWZjbGZwZHBsY3F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNTA5NTMsImV4cCI6MjEwMjgyNjk1M30.IJQ9ls4MDDml0ON-OpP-0ohq74HB0hUsng1muyGDyM0";

const SUPABASE_CONFIGURED = !SUPABASE_URL.includes("YOUR_SUPABASE") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],
  ['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],
  ['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],
  ['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
  ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],
  ['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],
  ['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],
  ['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
  ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],
  ['WY','Wyoming'],
];

const PLATE_TYPES = [
  'Passenger',
  'Commercial',
  'Motorcycle',
  'Trailer',
  'RV / Motorhome',
  'Disability',
  'Antique / Classic',
  'Vanity',
  'Government',
  'Temporary / Dealer',
];

// States with a real, live checkup integration. Everything else shows
// "coverage coming soon" instead of fabricating a result.
const LIVE_COVERAGE_STATES = ['NY'];

function populateStateSelect(selectEl) {
  STATES.forEach(([abbr, name]) => {
    const opt = document.createElement('option');
    opt.value = abbr;
    opt.textContent = `${name} (${abbr})`;
    selectEl.appendChild(opt);
  });
}

function populatePlateTypeSelect(selectEl) {
  PLATE_TYPES.forEach((type) => {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    selectEl.appendChild(opt);
  });
}

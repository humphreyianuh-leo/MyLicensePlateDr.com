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

// Real, live checkup integrations, keyed by the plate's registration state.
// Each covers one specific jurisdiction's open-data citation records, NOT
// the whole state. Everything not listed here shows "coverage coming soon"
// instead of fabricating a result.
const LIVE_JURISDICTIONS = {
  NY: {
    label: 'New York City',
    payUrl: 'https://www.nyc.gov/assets/finance/jump/pay_parking_camera_violations.html',
    payLabel: 'Pay Online at NYC Finance',
    async fetchCitations(plate) {
      const url = `https://data.cityofnewyork.us/resource/nc67-uf89.json?plate=${encodeURIComponent(plate)}&state=NY&$limit=25`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`NYC Open Data returned ${res.status}`);
      const rows = await res.json();
      return rows.map((r) => ({
        summonsNumber: r.summons_number,
        violation: r.violation,
        issueDate: r.issue_date,
        fineAmount: r.fine_amount,
        amountDue: r.amount_due,
      }));
    },
  },
  MD: {
    label: 'Baltimore City',
    payUrl: 'https://pay.baltimorecity.gov/parkingfines/',
    payLabel: 'Pay Online at Baltimore City Finance',
    async fetchCitations(plate) {
      const safePlate = plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const where = encodeURIComponent(`Tag='${safePlate}' AND State='MD'`);
      const url = `https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/Finance_Parking_Fines/FeatureServer/0/query?where=${where}&outFields=Citation,Tag,State,Description,ViolFine,ViolDate,Balance,GeneralStatus&f=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Baltimore Open Data returned ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'Baltimore Open Data error');
      return (data.features || []).map(({ attributes: r }) => ({
        summonsNumber: r.Citation,
        violation: r.Description,
        issueDate: r.ViolDate ? new Date(r.ViolDate).toLocaleDateString('en-US') : '—',
        fineAmount: r.ViolFine,
        amountDue: r.Balance,
      }));
    },
  },
};

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

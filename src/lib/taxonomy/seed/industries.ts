import type { TreeNode } from './types';

/**
 * Industries — WHO the customer is.
 *
 * Deliberately broad and vertical-neutral: 22 top-level industries, each with
 * one level of sub-industries. RepConnect is not optimised around any single
 * market, and this list is not weighted toward one.
 *
 * Going deeper in a particular vertical later is additive. A third level under
 * any node is a new entry here or a row created in the admin console — no
 * schema change, no user-data migration, no effect on profiles already using
 * the parent.
 */
export const INDUSTRIES: TreeNode[] = [
  {
    slug: 'software-technology',
    name: 'Software & Technology',
    children: [
      { slug: 'b2b-saas', name: 'B2B SaaS' },
      { slug: 'enterprise-software', name: 'Enterprise Software' },
      { slug: 'cybersecurity', name: 'Cybersecurity' },
      { slug: 'data-analytics', name: 'Data & Analytics' },
      { slug: 'developer-tools', name: 'Developer Tools & Infrastructure' },
      { slug: 'it-services', name: 'IT Services & Managed IT' },
      { slug: 'hardware-devices', name: 'Hardware & Devices' },
      { slug: 'artificial-intelligence', name: 'AI & Machine Learning' },
    ],
  },
  {
    slug: 'healthcare-life-sciences',
    name: 'Healthcare & Life Sciences',
    children: [
      { slug: 'medical-devices', name: 'Medical Devices' },
      { slug: 'pharmaceuticals', name: 'Pharmaceuticals' },
      { slug: 'biotechnology', name: 'Biotechnology' },
      { slug: 'health-it', name: 'Health IT & Digital Health' },
      { slug: 'dental', name: 'Dental' },
      { slug: 'veterinary', name: 'Veterinary' },
      { slug: 'laboratory-diagnostics', name: 'Laboratory & Diagnostics' },
      { slug: 'long-term-care', name: 'Long-Term & Senior Care' },
    ],
  },
  {
    slug: 'financial-services',
    name: 'Financial Services',
    children: [
      { slug: 'banking', name: 'Banking' },
      { slug: 'wealth-management', name: 'Wealth & Asset Management' },
      { slug: 'payments', name: 'Payments & Merchant Services' },
      { slug: 'lending', name: 'Lending & Credit' },
      { slug: 'fintech', name: 'Fintech' },
      { slug: 'accounting-tax', name: 'Accounting & Tax' },
    ],
  },
  {
    slug: 'insurance',
    name: 'Insurance',
    children: [
      { slug: 'property-casualty', name: 'Property & Casualty' },
      { slug: 'life-insurance', name: 'Life Insurance' },
      { slug: 'health-benefits', name: 'Health & Employee Benefits' },
      { slug: 'commercial-insurance', name: 'Commercial Lines' },
      { slug: 'reinsurance', name: 'Reinsurance' },
    ],
  },
  {
    slug: 'manufacturing-industrial',
    name: 'Manufacturing & Industrial',
    children: [
      { slug: 'industrial-equipment', name: 'Industrial Equipment & Machinery' },
      { slug: 'automation-robotics', name: 'Automation & Robotics' },
      { slug: 'electronics-components', name: 'Electronics & Components' },
      { slug: 'packaging', name: 'Packaging' },
      { slug: 'metals-fabrication', name: 'Metals & Fabrication' },
      { slug: 'plastics-rubber', name: 'Plastics & Rubber' },
      { slug: 'contract-manufacturing', name: 'Contract Manufacturing' },
    ],
  },
  {
    slug: 'construction-building',
    name: 'Construction & Building Products',
    children: [
      { slug: 'building-materials', name: 'Building Materials' },
      { slug: 'hvac-plumbing', name: 'HVAC, Plumbing & Electrical' },
      { slug: 'commercial-construction', name: 'Commercial Construction' },
      { slug: 'residential-construction', name: 'Residential Construction' },
      { slug: 'architecture-engineering', name: 'Architecture & Engineering' },
      { slug: 'heavy-equipment', name: 'Heavy Equipment & Rental' },
    ],
  },
  {
    slug: 'consumer-goods-retail',
    name: 'Consumer Goods & Retail',
    children: [
      { slug: 'apparel-accessories', name: 'Apparel & Accessories' },
      { slug: 'home-goods', name: 'Home & Furniture' },
      { slug: 'health-beauty', name: 'Health & Beauty' },
      { slug: 'sporting-goods', name: 'Sporting Goods & Outdoor' },
      { slug: 'toys-games', name: 'Toys & Games' },
      { slug: 'ecommerce-retail', name: 'E-commerce & Retail Technology' },
    ],
  },
  {
    slug: 'food-beverage',
    name: 'Food & Beverage',
    children: [
      { slug: 'food-manufacturing', name: 'Food Manufacturing' },
      { slug: 'foodservice-distribution', name: 'Foodservice & Distribution' },
      { slug: 'beverages', name: 'Beverages' },
      { slug: 'alcohol-spirits', name: 'Beer, Wine & Spirits' },
      { slug: 'restaurant-technology', name: 'Restaurant Technology & Supply' },
      { slug: 'agriculture-inputs', name: 'Agricultural Inputs' },
    ],
  },
  {
    slug: 'energy-utilities',
    name: 'Energy & Utilities',
    children: [
      { slug: 'oil-gas', name: 'Oil & Gas' },
      { slug: 'renewable-energy', name: 'Renewable Energy' },
      { slug: 'solar', name: 'Solar' },
      { slug: 'utilities', name: 'Utilities & Grid' },
      { slug: 'energy-efficiency', name: 'Energy Efficiency & Management' },
    ],
  },
  {
    slug: 'transportation-logistics',
    name: 'Transportation & Logistics',
    children: [
      { slug: 'freight-brokerage', name: 'Freight & Brokerage' },
      { slug: 'trucking', name: 'Trucking & Fleet' },
      { slug: 'warehousing', name: 'Warehousing & Fulfilment' },
      { slug: 'supply-chain-software', name: 'Supply Chain Software' },
      { slug: 'shipping-maritime', name: 'Shipping & Maritime' },
      { slug: 'aviation-aerospace', name: 'Aviation & Aerospace' },
    ],
  },
  {
    slug: 'real-estate-property',
    name: 'Real Estate & Property',
    children: [
      { slug: 'commercial-real-estate', name: 'Commercial Real Estate' },
      { slug: 'residential-real-estate', name: 'Residential Real Estate' },
      { slug: 'property-management', name: 'Property Management' },
      { slug: 'proptech', name: 'PropTech' },
      { slug: 'facilities-services', name: 'Facilities & Building Services' },
    ],
  },
  {
    slug: 'professional-services',
    name: 'Professional Services',
    children: [
      { slug: 'management-consulting', name: 'Management Consulting' },
      { slug: 'legal-services', name: 'Legal Services' },
      { slug: 'staffing-recruiting', name: 'Staffing & Recruiting' },
      { slug: 'hr-payroll', name: 'HR, Payroll & PEO' },
      { slug: 'outsourcing-bpo', name: 'Outsourcing & BPO' },
    ],
  },
  {
    slug: 'marketing-advertising',
    name: 'Marketing & Advertising',
    children: [
      { slug: 'digital-marketing', name: 'Digital Marketing & Agencies' },
      { slug: 'martech', name: 'Marketing Technology' },
      { slug: 'print-promotional', name: 'Print & Promotional Products' },
      { slug: 'events-experiential', name: 'Events & Experiential' },
      { slug: 'market-research', name: 'Market Research & Insights' },
    ],
  },
  {
    slug: 'education-training',
    name: 'Education & Training',
    children: [
      { slug: 'k12-education', name: 'K-12 Education' },
      { slug: 'higher-education', name: 'Higher Education' },
      { slug: 'corporate-training', name: 'Corporate Training & L&D' },
      { slug: 'edtech', name: 'EdTech' },
      { slug: 'certification-licensing', name: 'Certification & Licensing' },
    ],
  },
  {
    slug: 'telecommunications',
    name: 'Telecommunications',
    children: [
      { slug: 'wireless-mobile', name: 'Wireless & Mobile' },
      { slug: 'broadband-fiber', name: 'Broadband & Fiber' },
      { slug: 'unified-communications', name: 'Unified Communications & VoIP' },
      { slug: 'network-infrastructure', name: 'Network Infrastructure' },
      { slug: 'data-centers', name: 'Data Centers & Colocation' },
    ],
  },
  {
    slug: 'media-entertainment',
    name: 'Media & Entertainment',
    children: [
      { slug: 'broadcast-streaming', name: 'Broadcast & Streaming' },
      { slug: 'publishing', name: 'Publishing' },
      { slug: 'music-audio', name: 'Music & Audio' },
      { slug: 'gaming-esports', name: 'Gaming & Esports' },
      { slug: 'sports-teams', name: 'Sports & Teams' },
    ],
  },
  {
    slug: 'hospitality-travel',
    name: 'Hospitality & Travel',
    children: [
      { slug: 'hotels-lodging', name: 'Hotels & Lodging' },
      { slug: 'restaurants', name: 'Restaurants & Bars' },
      { slug: 'travel-tourism', name: 'Travel & Tourism' },
      { slug: 'hospitality-technology', name: 'Hospitality Technology' },
      { slug: 'catering-events', name: 'Catering & Venues' },
    ],
  },
  {
    slug: 'agriculture',
    name: 'Agriculture',
    children: [
      { slug: 'crop-production', name: 'Crop Production' },
      { slug: 'livestock', name: 'Livestock & Animal Health' },
      { slug: 'agtech', name: 'AgTech & Precision Agriculture' },
      { slug: 'farm-equipment', name: 'Farm Equipment' },
      { slug: 'forestry', name: 'Forestry & Timber' },
    ],
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    children: [
      { slug: 'auto-dealers', name: 'Dealers & Dealer Services' },
      { slug: 'auto-parts', name: 'Parts & Aftermarket' },
      { slug: 'fleet-services', name: 'Fleet & Commercial Vehicles' },
      { slug: 'electric-vehicles', name: 'Electric Vehicles & Charging' },
      { slug: 'auto-technology', name: 'Automotive Technology' },
    ],
  },
  {
    slug: 'chemicals-materials',
    name: 'Chemicals & Materials',
    children: [
      { slug: 'specialty-chemicals', name: 'Specialty Chemicals' },
      { slug: 'industrial-gases', name: 'Industrial Gases' },
      { slug: 'coatings-adhesives', name: 'Coatings & Adhesives' },
      { slug: 'advanced-materials', name: 'Advanced Materials & Composites' },
    ],
  },
  {
    slug: 'government-public-sector',
    name: 'Government & Public Sector',
    children: [
      { slug: 'federal-government', name: 'Federal / National Government' },
      { slug: 'state-local-government', name: 'State, Provincial & Local Government' },
      { slug: 'defense-security', name: 'Defense & National Security' },
      { slug: 'public-safety', name: 'Public Safety & Emergency Services' },
    ],
  },
  {
    slug: 'nonprofit-associations',
    name: 'Nonprofit & Associations',
    children: [
      { slug: 'charities-foundations', name: 'Charities & Foundations' },
      { slug: 'trade-associations', name: 'Trade & Professional Associations' },
      { slug: 'faith-based', name: 'Faith-Based Organisations' },
      { slug: 'membership-organisations', name: 'Membership Organisations' },
    ],
  },
];

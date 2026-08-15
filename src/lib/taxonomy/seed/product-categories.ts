import type { TreeNode } from './types';

/**
 * Product categories — WHAT is being sold.
 *
 * Deliberately orthogonal to industries, which describe WHO the customer is.
 * The two answer different questions and a rep's experience is often specific
 * to one but not the other: someone who sells capital equipment into hospitals
 * transfers well to capital equipment in manufacturing, and poorly to SaaS in
 * hospitals. Collapsing these into one list would lose exactly that signal.
 */
export const PRODUCT_CATEGORIES: TreeNode[] = [
  {
    slug: 'software-subscriptions',
    name: 'Software & Subscriptions',
    children: [
      { slug: 'saas-platform', name: 'SaaS Platform' },
      { slug: 'enterprise-license', name: 'Enterprise Licence' },
      { slug: 'mobile-applications', name: 'Mobile Applications' },
      { slug: 'api-usage-based', name: 'API & Usage-Based Products' },
      { slug: 'marketplace-platform', name: 'Marketplace & Platform Fees' },
    ],
  },
  {
    slug: 'capital-equipment',
    name: 'Capital Equipment',
    description: 'High-value assets with long cycles, financing and committee approval.',
    children: [
      { slug: 'production-machinery', name: 'Production Machinery' },
      { slug: 'medical-capital-equipment', name: 'Medical Capital Equipment' },
      { slug: 'vehicles-fleet', name: 'Vehicles & Fleet' },
      { slug: 'construction-equipment', name: 'Construction Equipment' },
      { slug: 'laboratory-instruments', name: 'Laboratory Instruments' },
    ],
  },
  {
    slug: 'hardware-devices-products',
    name: 'Hardware & Devices',
    children: [
      { slug: 'computing-hardware', name: 'Computing Hardware' },
      { slug: 'networking-equipment', name: 'Networking Equipment' },
      { slug: 'sensors-iot', name: 'Sensors & IoT Devices' },
      { slug: 'consumer-electronics', name: 'Consumer Electronics' },
      { slug: 'components-parts', name: 'Components & Parts' },
    ],
  },
  {
    slug: 'consumables-supplies',
    name: 'Consumables & Supplies',
    description: 'Repeat-purchase products where the sale is recurring by nature.',
    children: [
      { slug: 'medical-supplies', name: 'Medical & Surgical Supplies' },
      { slug: 'industrial-consumables', name: 'Industrial Consumables' },
      { slug: 'office-facility-supplies', name: 'Office & Facility Supplies' },
      { slug: 'food-ingredients', name: 'Food & Ingredients' },
      { slug: 'chemicals-lubricants', name: 'Chemicals & Lubricants' },
    ],
  },
  {
    slug: 'professional-services-sold',
    name: 'Professional Services',
    children: [
      { slug: 'consulting-engagements', name: 'Consulting Engagements' },
      { slug: 'implementation-integration', name: 'Implementation & Integration' },
      { slug: 'design-creative', name: 'Design & Creative Services' },
      { slug: 'legal-financial-services', name: 'Legal & Financial Services' },
      { slug: 'staffing-placement', name: 'Staffing & Placement' },
    ],
  },
  {
    slug: 'managed-recurring-services',
    name: 'Managed & Recurring Services',
    children: [
      { slug: 'managed-it-services', name: 'Managed IT & Security' },
      { slug: 'maintenance-contracts', name: 'Maintenance & Support Contracts' },
      { slug: 'facilities-management', name: 'Facilities Management' },
      { slug: 'logistics-services', name: 'Logistics & Fulfilment Services' },
      { slug: 'bpo-services', name: 'Outsourced Operations' },
    ],
  },
  {
    slug: 'financial-products',
    name: 'Financial & Insurance Products',
    children: [
      { slug: 'lending-products', name: 'Loans & Credit Products' },
      { slug: 'payment-processing', name: 'Payment Processing' },
      { slug: 'insurance-policies', name: 'Insurance Policies' },
      { slug: 'investment-products', name: 'Investment Products' },
      { slug: 'employee-benefits-products', name: 'Employee Benefits' },
    ],
  },
  {
    slug: 'media-advertising-inventory',
    name: 'Media & Advertising',
    children: [
      { slug: 'digital-advertising', name: 'Digital Advertising' },
      { slug: 'print-broadcast-advertising', name: 'Print & Broadcast Advertising' },
      { slug: 'sponsorships', name: 'Sponsorships & Partnerships' },
      { slug: 'event-exhibition-space', name: 'Event & Exhibition Space' },
    ],
  },
  {
    slug: 'training-certification',
    name: 'Training & Certification',
    children: [
      { slug: 'corporate-training-programs', name: 'Corporate Training Programmes' },
      { slug: 'online-courses', name: 'Online Courses & Curriculum' },
      { slug: 'certification-programs', name: 'Certification Programmes' },
    ],
  },
  {
    slug: 'memberships-licensing',
    name: 'Memberships & Licensing',
    children: [
      { slug: 'membership-subscriptions', name: 'Memberships & Dues' },
      { slug: 'ip-licensing', name: 'IP & Brand Licensing' },
      { slug: 'franchise-opportunities', name: 'Franchise Opportunities' },
      { slug: 'data-licensing', name: 'Data & Content Licensing' },
    ],
  },
  {
    slug: 'raw-materials',
    name: 'Raw Materials & Commodities',
    children: [
      { slug: 'metals-minerals', name: 'Metals & Minerals' },
      { slug: 'plastics-polymers', name: 'Plastics & Polymers' },
      { slug: 'agricultural-commodities', name: 'Agricultural Commodities' },
      { slug: 'energy-commodities', name: 'Energy Commodities' },
      { slug: 'textiles-fabrics', name: 'Textiles & Fabrics' },
    ],
  },
  {
    slug: 'construction-building-products',
    name: 'Construction & Building Products',
    children: [
      { slug: 'structural-materials', name: 'Structural Materials' },
      { slug: 'interior-finishes', name: 'Interior Finishes' },
      { slug: 'mechanical-systems', name: 'HVAC & Mechanical Systems' },
      { slug: 'electrical-lighting', name: 'Electrical & Lighting' },
      { slug: 'tools-hardware', name: 'Tools & Hardware' },
    ],
  },
];

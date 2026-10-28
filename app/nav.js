// nav.js — navigation items (03 §4). 'phone' items show in the tab bar; the rest sit under More
// on the phone and in the sidebar on iPad.
export const NAV = [
  { route: 'home', label: 'Home', phone: true },
  { route: 'transactions', label: 'Transactions', phone: true },
  { route: 'plan', label: 'Plan', phone: true },
  { route: 'funds', label: 'Funds', phone: true },
  { route: 'more', label: 'More', phone: true, phoneOnly: true },
  { route: 'summary', label: 'Summary' },
  { route: 'accounts', label: 'Accounts' },
  { route: 'categories', label: 'Categories' },
  { route: 'installments', label: 'Installment plans' },
  { route: 'thirteenth', label: '13th-month plan' },
  { route: 'settings', label: 'Settings' },
];

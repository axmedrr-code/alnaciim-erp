import { BILLING_GROUP, DepartmentProvider } from './finance/BillingCollectionsTab';

// Collectors work with Billing & Collections directly (dashboard, receivables, receive payment, payment history, aging)
// without needing the Finance console. The same module is shown inside Finance for Finance Officers and Admin.
const BillingCollectionsPage = BILLING_GROUP.items[0].Component;

export default function CollectionsPage() {
  return (
    <div>
      <div className="page-header"><h1>Collections</h1></div>
      <DepartmentProvider>
        <BillingCollectionsPage />
      </DepartmentProvider>
    </div>
  );
}

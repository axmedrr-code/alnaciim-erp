import TruckLoadsTab from './sales/TruckLoadsTab';

// Warehouse and Data Entry staff work with tanker loading here without needing the Sales & Distribution console:
// the Storekeeper opens a Route Session (Load Tanker) and the Data Entry Operator closes it (Reconcile / Complete).
// What each person can do is decided inside TruckLoadsTab by role, and enforced again by the API.
export default function TankerLoadingPage() {
  return (
    <div>
      <div className="page-header"><h1>Tanker Loading</h1></div>
      <p className="muted" style={{ marginBottom: 14 }}>
        Storekeepers load a tanker from the Finished Water Warehouse; Data Entry closes the route session by reconciling the water left on the truck.
        The person who loaded a truck cannot close that session.
      </p>
      <TruckLoadsTab />
    </div>
  );
}

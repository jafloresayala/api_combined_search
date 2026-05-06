interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  icon: string;
}

export function StatCard({ label, value, sub, highlight, icon }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-sm flex flex-col gap-1 ${
        highlight
          ? 'border-green-300 bg-green-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 text-gray-500 text-xs uppercase tracking-wide font-medium">
        <span className="text-lg">{icon}</span>
        {label}
      </div>
      <p className={`text-2xl font-bold truncate ${highlight ? 'text-green-700' : 'text-gray-800'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
    </div>
  );
}

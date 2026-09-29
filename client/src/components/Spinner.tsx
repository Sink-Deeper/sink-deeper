export function Spinner({ className = "" }: { className?: string }) {
  return <div className={`h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent ${className}`} />;
}
export function PageSpinner() {
  return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>;
}

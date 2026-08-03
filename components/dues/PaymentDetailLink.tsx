import Link from "next/link";

export function PaymentDetailLink({ paymentId, children }: { paymentId: string; children: React.ReactNode }) {
  return <Link href={`/payments/${paymentId}`} className="underline underline-offset-2">{children}</Link>;
}


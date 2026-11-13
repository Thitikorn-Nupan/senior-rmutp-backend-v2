export default ({env}: {
    env: { int: (key: string, fallback: number) => number; (key: string, fallback: string): string }
}) => ({
    slipDirectory: env('PAYMENT_SLIP_DIR', '.private/payment-slips'),
    paymentWindowMinutes: env.int('PAYMENT_WINDOW_MINUTES', 30),
});

declare module "react-native-razorpay" {
  export type RazorpaySuccessData = {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
    [key: string]: unknown;
  };

  export type RazorpayErrorData = {
    code?: number;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    metadata?: {
      order_id?: string;
      payment_id?: string;
      [key: string]: unknown;
    };
  };

  const RazorpayCheckout: {
    open(options: Record<string, unknown>): Promise<RazorpaySuccessData>;
  };

  export default RazorpayCheckout;
}

import { transactionResponse } from "@/lib/prep-handlers";
export async function POST(request: Request) { return transactionResponse(request); }

import { prepQueryResponse } from "@/lib/prep-handlers";
export async function POST(request: Request) { return prepQueryResponse(request); }

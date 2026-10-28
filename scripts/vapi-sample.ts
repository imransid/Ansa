// A realistic, made-up Vapi end-of-call-report, shared by the simulator and
// the tenant isolation checks. Field paths follow Vapi's docs.

type SampleReport = {
  callId: string;
  phoneNumberId: string;
  callerNumber: string;
  transcript: string;
};

export const SAMPLE_TRANSCRIPT = [
  "AI: Thanks for calling. How can I help you today?",
  "User: Hi, my order arrived yesterday and the screen is cracked.",
  "AI: I'm sorry to hear that. Can you tell me your order number?",
  "User: It's 48213. I'd like a replacement, not a refund.",
  "AI: I can't arrange replacements myself, so I'm passing this to our team.",
].join("\n");

export function buildSampleEndOfCallReport(sample: SampleReport) {
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - 3 * 60 * 1000 - 12 * 1000);
  return {
    message: {
      type: "end-of-call-report",
      endedReason: "customer-ended-call",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      artifact: {
        transcript: sample.transcript,
        messages: [],
        // Must be dropped by the app: never stored, never logged.
        recordingUrl: "https://storage.example.test/recordings/secret-recording.wav",
      },
      call: {
        id: sample.callId,
        type: "inboundPhoneCall",
        phoneNumberId: sample.phoneNumberId,
        customer: { number: sample.callerNumber },
        // Must be ignored: the company comes from our phone_lines table only.
        orgId: "attacker-org",
        metadata: { companyId: "00000000-0000-4000-8000-000000000000" },
      },
    },
  };
}

type SampleToolCall = {
  id: string;
  name: string;
  // An object, or the same as a JSON string: Vapi's docs and API spec differ.
  arguments: unknown;
};

type SampleToolCallsMessage = {
  callId: string;
  phoneNumberId: string;
  callerNumber: string;
  toolCalls: SampleToolCall[];
  // What the live transcript says so far (message.artifact).
  transcript: string;
};

// A made-up Vapi tool-calls message (step 35), as the assistant sends it
// during a live call. Field paths follow Vapi's docs and API spec.
export function buildSampleToolCallsMessage(sample: SampleToolCallsMessage) {
  const toolCallList = sample.toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: { name: toolCall.name, arguments: toolCall.arguments },
  }));
  return {
    message: {
      type: "tool-calls",
      timestamp: Date.now(),
      toolCallList,
      toolWithToolCallList: toolCallList.map((toolCall) => ({
        type: "function",
        function: { name: toolCall.function.name, parameters: { type: "object" } },
        toolCall,
      })),
      call: {
        id: sample.callId,
        type: "inboundPhoneCall",
        phoneNumberId: sample.phoneNumberId,
        // Must be ignored: the company comes from our phone_lines table only.
        orgId: "attacker-org",
        metadata: { companyId: "00000000-0000-4000-8000-000000000000" },
      },
      customer: { number: sample.callerNumber },
      // Must never be stored or logged: the live transcript and recording
      // links, and the phone provider's secrets.
      artifact: { transcript: sample.transcript, recordingUrl: "https://storage.example.test/recordings/live-recording.wav" },
      phoneNumber: { provider: "twilio", number: "+1 555 0100", twilioAuthToken: "twilio-secret-token" },
    },
  };
}

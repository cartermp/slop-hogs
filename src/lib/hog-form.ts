export type HogActionFormState = {
  status: "idle" | "success" | "error";
  message: string;
  requestId: string;
};

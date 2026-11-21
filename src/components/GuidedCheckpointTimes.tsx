const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function GuidedCheckpointTimes({ checkpoint, status = false }: {
  checkpoint: { createdAt: string; expiresAt: string };
  status?: boolean;
}) {
  const { createdAt, expiresAt } = checkpoint;
  return <>{status ? "Draft saved locally at" : "Saved"}{" "}
    <time dateTime={createdAt}>{dateTimeFormat.format(new Date(createdAt))}</time> · expires{" "}
    <time dateTime={expiresAt}>{dateTimeFormat.format(new Date(expiresAt))}</time></>;
}

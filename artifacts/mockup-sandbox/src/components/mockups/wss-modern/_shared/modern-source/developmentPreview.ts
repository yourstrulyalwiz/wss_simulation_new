export function chooseDevelopmentPreview(session: any, scenarios: any[], preview: any, seenRevision: string | null) {
  if (!preview?.bundle || !preview?.revision || seenRevision === preview.revision) {
    return { session, scenarios, switched: false };
  }
  const saved = [...scenarios];
  if (session?.inputs && JSON.stringify(session) !== JSON.stringify(preview.bundle)) {
    const baseName = 'Previous working session before DRC preview';
    let name = baseName;
    let counter = 2;
    while (saved.some(item => item.name === name)) name = `${baseName} (${counter++})`;
    saved.push({ name, inputs: session });
  }
  return { session: preview.bundle, scenarios: saved, switched: true };
}
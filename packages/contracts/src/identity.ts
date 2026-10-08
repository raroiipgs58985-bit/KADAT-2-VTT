/** Runtime identity is deliberately separate from canonical template data. */
export interface ActorReference {
  readonly actorId: string;
}

export interface CanonicalReference {
  readonly releaseId: string;
  readonly templateId: string;
  readonly templateVersion: string;
}

export interface ActorIdentity extends ActorReference {
  readonly origin?: CanonicalReference;
}

export interface SourceReference {
  readonly kind: string;
  readonly id: string;
  readonly actor?: ActorReference;
  readonly canonical?: CanonicalReference;
}

export interface Provenance {
  readonly source: SourceReference;
  readonly record?: string;
  readonly reason: string;
}

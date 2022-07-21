import { AuditLog, IdsAndPreferences, Seed, TransmissionResponse, TransmissionResult } from './generated-model';
import { CurrentModelVersion } from './model';

export const buildAuditLog = (
  seed: Seed,
  data: IdsAndPreferences,
  response: TransmissionResponse,
  contentId: string
): AuditLog | undefined => {
  if (response.version !== CurrentModelVersion) {
    return undefined;
  }
  const path = findTransactionPath(response, contentId);
  if (path === undefined) {
    return undefined;
  }
  return {
    version: CurrentModelVersion,
    data,
    seed,
    transaction_id: path.transactionId,
    transmissions: path.results,
  };
};

/**
 * Wrapper around TransmissionResponse to keep
 * track of visited children.
 */
class TreeTraversalTracker {
  private remainingChildrenIndex = 0;

  constructor(public node: TransmissionResponse) {}

  hasUnvisitedChildren(): boolean {
    return this.remainingChildrenIndex < this.node.children.length;
  }

  popNextUnvisitedChild(): TreeTraversalTracker | undefined {
    if (!this.hasUnvisitedChildren()) {
      return undefined;
    }
    const next = this.node.children[this.remainingChildrenIndex];
    this.remainingChildrenIndex += 1;
    return new TreeTraversalTracker(next);
  }
}

interface TransactionPath {
  /** All the transmission results participating to the contentId, in order. */
  results: TransmissionResult[];
  transactionId: string;
}

/**
 * Find a list a Transaction Result by considering the TransmissionResponse as
 * a tree data-structure and implementing an iterative Depth-First Search.
 */
export const findTransactionPath = (response: TransmissionResponse, contentId: string): TransactionPath | undefined => {
  const stack: TreeTraversalTracker[] = [];
  let current = new TreeTraversalTracker(response);
  while (current !== undefined || stack.length > 0) {
    // Go to next leaf
    while (current !== undefined) {
      stack.push(current);
      const content = current.node.contents.find((c) => c.content_id === contentId);
      if (content !== undefined) {
        return {
          results: stack.map((t) => fromResponseToResult(t.node)),
          transactionId: content.transaction_id,
        };
      }
      current = current.popNextUnvisitedChild(); // current = undefined; if no more children.
    }

    // Pop all the nodes without child because
    // we checked them in the depth search (above).
    // Once found we are ready to go in a depth search again.
    current = stack.pop();
    while (current !== undefined && !current?.hasUnvisitedChildren()) {
      current = stack.pop(); // current = undefined; when there is no more element in the stack.
    }
  }

  return undefined;
};

export const fromResponseToResult = (r: TransmissionResponse): TransmissionResult => {
  const { version, receiver, contents, status, details, source } = r;
  return { version, receiver, contents, status, details, source };
};

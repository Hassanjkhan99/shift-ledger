/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { GraphQLClient } from 'graphql-request';
// RequestInit is a global DOM type (tsconfig lib: dom).
import { useQuery, useSuspenseQuery, UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query';

function fetcher<TData, TVariables extends { [key: string]: any }>(client: GraphQLClient, query: string, variables?: TVariables, requestHeaders?: RequestInit['headers']) {
  return async (): Promise<TData> => client.request({
    document: query,
    variables,
    requestHeaders
  });
}
export type CheckType =
  | 'allergen'
  | 'cleaning'
  | 'closing'
  | 'generic'
  | 'opening'
  | 'temperature';

export type ExceptionStatus =
  | 'acknowledged'
  | 'in_progress'
  | 'open'
  | 'reopened'
  | 'resolved'
  | 'verified';

export type OccurrenceStatus =
  | 'cancelled'
  | 'completed'
  | 'completed_late'
  | 'due'
  | 'failed'
  | 'overdue'
  | 'pending'
  | 'skipped';

export type OrgRole =
  | 'Auditor'
  | 'ExternalInspector'
  | 'KitchenManager'
  | 'OrgAdmin'
  | 'Owner'
  | 'PropertyManager'
  | 'ShiftLeader'
  | 'Staff';

export type ExceptionsQueryVariables = Exact<{
  status?: ExceptionStatus | null | undefined;
  cursor?: string | null | undefined;
  limit?: number | null | undefined;
}>;


export type ExceptionsQuery = { exceptions: { nextCursor: string | null, items: Array<{ id: string, status: ExceptionStatus, severity: string, title: string, detail: string | null, outletId: string, propertyId: string, openedAt: string }> } };

export type OpenExceptionsCountQueryVariables = Exact<{ [key: string]: never; }>;


export type OpenExceptionsCountQuery = { openExceptionsCount: number };

export type OccurrencesTodayQueryVariables = Exact<{
  outletId?: string | number | null | undefined;
  status?: OccurrenceStatus | null | undefined;
  date?: string | null | undefined;
}>;


export type OccurrencesTodayQuery = { occurrencesToday: Array<{ outlet: { id: string, name: string, propertyId: string }, occurrences: Array<{ id: string, outletId: string, status: OccurrenceStatus, checkType: CheckType, dueAt: string, occurrenceLocalDate: string, timezone: string, assigneeRole: OrgRole | null, assigneeUserId: string | null, configSnapshot: unknown, template: { id: string, title: string, checkType: CheckType, requiredEvidence: Array<string> }, currentCompletion: { id: string, result: string, isCurrent: boolean, version: number, recordedAt: string, evidenceCount: number } | null }> }> };

export type OccurrenceQueryVariables = Exact<{
  id: string | number;
}>;


export type OccurrenceQuery = { occurrence: { id: string, outletId: string, status: OccurrenceStatus, checkType: CheckType, dueAt: string, occurrenceLocalDate: string, timezone: string, assigneeRole: OrgRole | null, assigneeUserId: string | null, configSnapshot: unknown, template: { id: string, title: string, checkType: CheckType, requiredEvidence: Array<string> }, currentCompletion: { id: string, result: string, isCurrent: boolean, version: number, recordedAt: string, evidenceCount: number } | null } | null };



export const ExceptionsDocument = `
    query Exceptions($status: ExceptionStatus, $cursor: String, $limit: Int) {
  exceptions(status: $status, cursor: $cursor, limit: $limit) {
    items {
      id
      status
      severity
      title
      detail
      outletId
      propertyId
      openedAt
    }
    nextCursor
  }
}
    `;

export const useExceptionsQuery = <
      TData = ExceptionsQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: ExceptionsQueryVariables,
      options?: Omit<UseQueryOptions<ExceptionsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<ExceptionsQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useQuery<ExceptionsQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['Exceptions'] : ['Exceptions', variables],
    queryFn: fetcher<ExceptionsQuery, ExceptionsQueryVariables>(client, ExceptionsDocument, variables, headers),
    ...options
  }
    )};

useExceptionsQuery.getKey = (variables?: ExceptionsQueryVariables) => variables === undefined ? ['Exceptions'] : ['Exceptions', variables];

export const useSuspenseExceptionsQuery = <
      TData = ExceptionsQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: ExceptionsQueryVariables,
      options?: Omit<UseSuspenseQueryOptions<ExceptionsQuery, TError, TData>, 'queryKey'> & { queryKey?: UseSuspenseQueryOptions<ExceptionsQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useSuspenseQuery<ExceptionsQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['Exceptions'] : ['Exceptions', variables],
    queryFn: fetcher<ExceptionsQuery, ExceptionsQueryVariables>(client, ExceptionsDocument, variables, headers),
    ...options
  }
    )};

useSuspenseExceptionsQuery.getKey = (variables?: ExceptionsQueryVariables) => variables === undefined ? ['Exceptions'] : ['Exceptions', variables];


useExceptionsQuery.fetcher = (client: GraphQLClient, variables?: ExceptionsQueryVariables, headers?: RequestInit['headers']) => fetcher<ExceptionsQuery, ExceptionsQueryVariables>(client, ExceptionsDocument, variables, headers);

export const OpenExceptionsCountDocument = `
    query OpenExceptionsCount {
  openExceptionsCount
}
    `;

export const useOpenExceptionsCountQuery = <
      TData = OpenExceptionsCountQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: OpenExceptionsCountQueryVariables,
      options?: Omit<UseQueryOptions<OpenExceptionsCountQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<OpenExceptionsCountQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useQuery<OpenExceptionsCountQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['OpenExceptionsCount'] : ['OpenExceptionsCount', variables],
    queryFn: fetcher<OpenExceptionsCountQuery, OpenExceptionsCountQueryVariables>(client, OpenExceptionsCountDocument, variables, headers),
    ...options
  }
    )};

useOpenExceptionsCountQuery.getKey = (variables?: OpenExceptionsCountQueryVariables) => variables === undefined ? ['OpenExceptionsCount'] : ['OpenExceptionsCount', variables];

export const useSuspenseOpenExceptionsCountQuery = <
      TData = OpenExceptionsCountQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: OpenExceptionsCountQueryVariables,
      options?: Omit<UseSuspenseQueryOptions<OpenExceptionsCountQuery, TError, TData>, 'queryKey'> & { queryKey?: UseSuspenseQueryOptions<OpenExceptionsCountQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useSuspenseQuery<OpenExceptionsCountQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['OpenExceptionsCount'] : ['OpenExceptionsCount', variables],
    queryFn: fetcher<OpenExceptionsCountQuery, OpenExceptionsCountQueryVariables>(client, OpenExceptionsCountDocument, variables, headers),
    ...options
  }
    )};

useSuspenseOpenExceptionsCountQuery.getKey = (variables?: OpenExceptionsCountQueryVariables) => variables === undefined ? ['OpenExceptionsCount'] : ['OpenExceptionsCount', variables];


useOpenExceptionsCountQuery.fetcher = (client: GraphQLClient, variables?: OpenExceptionsCountQueryVariables, headers?: RequestInit['headers']) => fetcher<OpenExceptionsCountQuery, OpenExceptionsCountQueryVariables>(client, OpenExceptionsCountDocument, variables, headers);

export const OccurrencesTodayDocument = `
    query OccurrencesToday($outletId: ID, $status: OccurrenceStatus, $date: String) {
  occurrencesToday(outletId: $outletId, status: $status, date: $date) {
    outlet {
      id
      name
      propertyId
    }
    occurrences {
      id
      outletId
      status
      checkType
      dueAt
      occurrenceLocalDate
      timezone
      assigneeRole
      assigneeUserId
      configSnapshot
      template {
        id
        title
        checkType
        requiredEvidence
      }
      currentCompletion {
        id
        result
        isCurrent
        version
        recordedAt
        evidenceCount
      }
    }
  }
}
    `;

export const useOccurrencesTodayQuery = <
      TData = OccurrencesTodayQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: OccurrencesTodayQueryVariables,
      options?: Omit<UseQueryOptions<OccurrencesTodayQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<OccurrencesTodayQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useQuery<OccurrencesTodayQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['OccurrencesToday'] : ['OccurrencesToday', variables],
    queryFn: fetcher<OccurrencesTodayQuery, OccurrencesTodayQueryVariables>(client, OccurrencesTodayDocument, variables, headers),
    ...options
  }
    )};

useOccurrencesTodayQuery.getKey = (variables?: OccurrencesTodayQueryVariables) => variables === undefined ? ['OccurrencesToday'] : ['OccurrencesToday', variables];

export const useSuspenseOccurrencesTodayQuery = <
      TData = OccurrencesTodayQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables?: OccurrencesTodayQueryVariables,
      options?: Omit<UseSuspenseQueryOptions<OccurrencesTodayQuery, TError, TData>, 'queryKey'> & { queryKey?: UseSuspenseQueryOptions<OccurrencesTodayQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useSuspenseQuery<OccurrencesTodayQuery, TError, TData>(
      {
    queryKey: variables === undefined ? ['OccurrencesToday'] : ['OccurrencesToday', variables],
    queryFn: fetcher<OccurrencesTodayQuery, OccurrencesTodayQueryVariables>(client, OccurrencesTodayDocument, variables, headers),
    ...options
  }
    )};

useSuspenseOccurrencesTodayQuery.getKey = (variables?: OccurrencesTodayQueryVariables) => variables === undefined ? ['OccurrencesToday'] : ['OccurrencesToday', variables];


useOccurrencesTodayQuery.fetcher = (client: GraphQLClient, variables?: OccurrencesTodayQueryVariables, headers?: RequestInit['headers']) => fetcher<OccurrencesTodayQuery, OccurrencesTodayQueryVariables>(client, OccurrencesTodayDocument, variables, headers);

export const OccurrenceDocument = `
    query Occurrence($id: ID!) {
  occurrence(id: $id) {
    id
    outletId
    status
    checkType
    dueAt
    occurrenceLocalDate
    timezone
    assigneeRole
    assigneeUserId
    configSnapshot
    template {
      id
      title
      checkType
      requiredEvidence
    }
    currentCompletion {
      id
      result
      isCurrent
      version
      recordedAt
      evidenceCount
    }
  }
}
    `;

export const useOccurrenceQuery = <
      TData = OccurrenceQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables: OccurrenceQueryVariables,
      options?: Omit<UseQueryOptions<OccurrenceQuery, TError, TData>, 'queryKey'> & { queryKey?: UseQueryOptions<OccurrenceQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useQuery<OccurrenceQuery, TError, TData>(
      {
    queryKey: ['Occurrence', variables],
    queryFn: fetcher<OccurrenceQuery, OccurrenceQueryVariables>(client, OccurrenceDocument, variables, headers),
    ...options
  }
    )};

useOccurrenceQuery.getKey = (variables: OccurrenceQueryVariables) => ['Occurrence', variables];

export const useSuspenseOccurrenceQuery = <
      TData = OccurrenceQuery,
      TError = unknown
    >(
      client: GraphQLClient,
      variables: OccurrenceQueryVariables,
      options?: Omit<UseSuspenseQueryOptions<OccurrenceQuery, TError, TData>, 'queryKey'> & { queryKey?: UseSuspenseQueryOptions<OccurrenceQuery, TError, TData>['queryKey'] },
      headers?: RequestInit['headers']
    ) => {
    
    return useSuspenseQuery<OccurrenceQuery, TError, TData>(
      {
    queryKey: ['Occurrence', variables],
    queryFn: fetcher<OccurrenceQuery, OccurrenceQueryVariables>(client, OccurrenceDocument, variables, headers),
    ...options
  }
    )};

useSuspenseOccurrenceQuery.getKey = (variables: OccurrenceQueryVariables) => ['Occurrence', variables];


useOccurrenceQuery.fetcher = (client: GraphQLClient, variables: OccurrenceQueryVariables, headers?: RequestInit['headers']) => fetcher<OccurrenceQuery, OccurrenceQueryVariables>(client, OccurrenceDocument, variables, headers);

// Module imports
import { Client, CredentialManager, ok } from '@atcute/client'

export function getPublishedLexicons(
	client: Client,
	credentialManager: CredentialManager,
	cursor?: string,
) {
	return ok(
		client.get('com.atproto.repo.listRecords', {
			params: {
				repo: credentialManager.session!.did,
				collection: 'com.atproto.lexicon.schema',
				limit: 100,
				cursor,
			},
		}),
	)
}

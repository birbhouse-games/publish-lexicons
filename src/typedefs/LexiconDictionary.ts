// Local imports
import { LocalLexicon } from './LocalLexicon'
import { PublishedLexicon } from './PublishedLexicon'

export type LexiconDictionary = Record<
	string,
	{
		local: LocalLexicon
		published?: PublishedLexicon
		shouldPublish: boolean
	}
>

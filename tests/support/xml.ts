import { DOMParser } from '@xmldom/xmldom';
import type { ParseXml } from '../../src/domain/kml.ts';

/** Node has no DOMParser; @xmldom/xmldom offers the same interface for tests and scripts. */
export const parseXml: ParseXml = (text) => new DOMParser().parseFromString(text, 'text/xml');

/**
 * MusicXML export — unpitched percussion part on a 5-line percussion staff.
 * Importable into MuseScore / Sibelius / Finale / Dorico.
 */

import type { DrumType, Transcription } from '../../types';
import { buildScore } from '../score';

const DRUM_XML: Record<DrumType, { step: string; octave: number; notehead?: string; instrumentId: string; name: string }> = {
  kick: { step: 'F', octave: 4, instrumentId: 'P1-I36', name: 'Bass Drum' },
  'tom-low': { step: 'A', octave: 4, instrumentId: 'P1-I43', name: 'Floor Tom' },
  snare: { step: 'C', octave: 5, instrumentId: 'P1-I38', name: 'Snare Drum' },
  'tom-mid': { step: 'D', octave: 5, instrumentId: 'P1-I47', name: 'Mid Tom' },
  'tom-high': { step: 'E', octave: 5, instrumentId: 'P1-I48', name: 'High Tom' },
  ride: { step: 'F', octave: 5, notehead: 'x', instrumentId: 'P1-I51', name: 'Ride Cymbal' },
  'hihat-closed': { step: 'G', octave: 5, notehead: 'x', instrumentId: 'P1-I42', name: 'Closed Hi-Hat' },
  'hihat-open': { step: 'G', octave: 5, notehead: 'x', instrumentId: 'P1-I46', name: 'Open Hi-Hat' },
  crash: { step: 'A', octave: 5, notehead: 'x', instrumentId: 'P1-I49', name: 'Crash Cymbal' },
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function transcriptionToMusicXML(t: Transcription, title = 'Drum Transcription'): Blob {
  const score = buildScore(t);
  const divisions = t.quantize / 4; // divisions per quarter note
  const slotDivisions = 1; // each slot is one division at this resolution

  const noteType =
    t.quantize === 4 ? 'quarter' : t.quantize === 8 ? 'eighth' : t.quantize === 16 ? '16th' : '32nd';

  const instruments = Object.entries(DRUM_XML)
    .map(
      ([, v]) =>
        `      <score-instrument id="${v.instrumentId}"><instrument-name>${esc(v.name)}</instrument-name></score-instrument>`,
    )
    .join('\n');

  const measuresXml = score.measures
    .map((measure) => {
      let body = '';
      if (measure.index === 0) {
        body += `      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>percussion</sign><line>2</line></clef>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(t.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(t.bpm)}"/></direction>\n`;
      }
      for (const slot of measure.slots) {
        if (slot.drums.length === 0) {
          body += `      <note><rest/><duration>${slotDivisions}</duration><type>${noteType}</type></note>\n`;
        } else {
          slot.drums.forEach((d, i) => {
            const m = DRUM_XML[d.drum];
            body += `      <note>${i > 0 ? '<chord/>' : ''}<unpitched><display-step>${m.step}</display-step><display-octave>${m.octave}</display-octave></unpitched><duration>${slotDivisions}</duration><instrument id="${m.instrumentId}"/><type>${noteType}</type>${m.notehead ? `<notehead>${m.notehead}</notehead>` : ''}</note>\n`;
          });
        }
      }
      return `    <measure number="${measure.index + 1}">\n${body}    </measure>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${esc(title)}</work-title></work>
  <part-list>
    <score-part id="P1">
      <part-name>Drum Set</part-name>
${instruments}
    </score-part>
  </part-list>
  <part id="P1">
${measuresXml}
  </part>
</score-partwise>
`;
  return new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' });
}

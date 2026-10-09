// Set penalties from By-law 17-225 Schedule A (consolidation 23 April 2025).
// Each row was checked against the 17-225 PDF page, not the text extract
// (pdftotext scrambles the table columns). Source PDFs: G:\Hammer Street\bylaws\.
// Used by the Bylaw page guide and the printable quick-reference PDF.
// Row: [what the offence is, by-law and section, set penalty]

export const FINES_SOURCE = 'Set penalties: By-law 17-225, Schedule A (consolidation 23 April 2025).';

export const FINES = {
  'Litter or Debris': [
    ['Yard not kept free of waste',                     '10-118 s.4(1)',    '$95'],
    ['Boulevard beside the property not kept free of waste', '10-118 s.4(1.1)', '$95'],
    ['Waste left to collect for more than 10 days',     '10-118 s.4(5)(b)', '$95'],
    ['Throwing litter on a street or sidewalk',         '86-077 s.9(4)(a)', '$75'],
    ['Adjacent owner does not remove fouling from the street at once', '86-077 s.9(5)', '$200'],
    ['Dumping litter in a park',                        '01-219 s.9(a)',    '$100'],
  ],
  'Graffiti': [
    ['Owner does not clean graffiti from their property', '10-118 s.5(1)',  '$95'],
    ['Defacing a building, structure or City property in a park', '01-219 s.8(b)', '$200'],
  ],
  'Dumped Garbage': [
    ['Depositing waste on property without written permission', '10-118 s.6(1)', '$225'],
    ['Depositing waste on City property without written permission', '10-118 s.6(2)', '$225'],
    ['Using a yard to deposit waste',                   '10-118 s.4(2)',    '$95'],
    ['Placing rubbish or refuse on a street',           '86-077 s.9(4)(a)', '$75'],
  ],
  'Illegal Dumping': [
    ['Depositing waste on property without written permission', '10-118 s.6(1)', '$225'],
    ['Depositing waste on City property without written permission', '10-118 s.6(2)', '$225'],
    ['Dumping garbage or refuse in a park',             '01-219 s.9(a)',    '$100'],
    ['Dumping building or construction material in a park', '01-219 s.9(c)', '$200'],
  ],
  'Overgrown Vegetation': [
    ['Vegetation not kept clean and cleared up',        '10-118 s.3(1)(a)', '$75'],
  ],
  'Vacant Property': [
    ['Vacant building not registered within 30 days',   '17-127 s.4',       '$200'],
    ['Vacant building does not comply with the Yard Maintenance By-law', '17-127 s.9(b)', '$300'],
    ['Vacant building not checked every 2 weeks',       '17-127 s.9(d)',    '$200'],
  ],
  'Dead Animal': [
    ['Placing an animal carcass on a street',           '86-077 s.9(4)(a)', '$75'],
  ],
  'Traffic Sign or Light Issue': [
    ['A sign that blocks the view of a traffic signal', '10-197 s.4.1(f)',  '$200'],
    ['A sign placed on a traffic signal',               '10-197 s.4.1(g)',  '$100'],
  ],
  'Missed Snow/Ice Clearing': [
    ['Sidewalk not cleared of snow and ice within 24 hours after a storm', '03-296 s.5', '$65'],
    ['Snow or ice put on or next to a fire hydrant',    '03-296 s.7(a)',    '$100'],
  ],
  'Other': [
    ['Poster on public property for more than 21 days', '10-197 s.5.8.2(b)', '$100'],
    ['Poster not removed within 3 days after the event', '10-197 s.5.8.2(b)', '$100'],
    ['Urinating in a public place',                     '20-077 s.3',       '$205'],
    ['Knocking over a waste container on a street',     '20-077 s.4',       '$205'],
  ],
};

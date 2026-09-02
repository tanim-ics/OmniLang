import express from 'express';
import Vocabulary from '../models/Vocabulary.js';
import VocabBank   from '../models/VocabBank.js';
import User        from '../models/User.js';
import { checkAndAwardAchievements, getOrCreateDailyStatus } from './auth.js';
import { callOllama } from '../utils/ollama.js';

const router = express.Router();
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// ---- Leitner SRS math (per CLAUDE.md) ----
// Wrong: srsStage=1, nextReview = +1 day
// Correct: srsStage = min(stage+1, 5), nextReview = now + (srsStage * 3) days
function leitnerNext(srsStage, correct) {
    if (!correct) {
        return { srsStage: 1, nextReviewDate: new Date(Date.now() + 86400000) };
    }
    const newStage = Math.min(srsStage + 1, 5);
    return {
        srsStage: newStage,
        nextReviewDate: new Date(Date.now() + newStage * 3 * 86400000)
    };
}

// Massive CEFR vocabulary dictionary for non-repeating generation & fallbacks (35+ words per level)
const EXPANDED_FALLBACKS = {
    A1: [
        { word: 'kennenlernen', translation: 'to get to know', type: 'verb', example: 'Ich möchte dich gerne kennenlernen.', exampleEn: 'I would like to get to know you.', topic: 'Social' },
        { word: 'die Überraschung', translation: 'the surprise', type: 'noun', example: 'Das ist eine tolle Überraschung!', exampleEn: 'That is a great surprise!', topic: 'Feelings' },
        { word: 'gemütlich', translation: 'cozy / comfortable', type: 'adjective', example: 'Das Café ist sehr gemütlich.', exampleEn: 'The café is very cozy.', topic: 'Places' },
        { word: 'die Einladung', translation: 'the invitation', type: 'noun', example: 'Vielen Dank für die Einladung!', exampleEn: 'Thank you very much for the invitation!', topic: 'Social' },
        { word: 'frühstücken', translation: 'to have breakfast', type: 'verb', example: 'Um wie viel Uhr frühstückst du?', exampleEn: 'What time do you have breakfast?', topic: 'Daily Life' },
        { word: 'der Bahnhof', translation: 'train station', type: 'noun', example: 'Wir treffen uns am Bahnhof.', exampleEn: 'We meet at the train station.', topic: 'Travel' },
        { word: 'die Fahrkarte', translation: 'ticket', type: 'noun', example: 'Wo kann ich eine Fahrkarte kaufen?', exampleEn: 'Where can I buy a ticket?', topic: 'Travel' },
        { word: 'der Schlüssel', translation: 'the key', type: 'noun', example: 'Wo ist mein Schlüssel?', exampleEn: 'Where is my key?', topic: 'Everyday' },
        { word: 'das Geschenk', translation: 'the present / gift', type: 'noun', example: 'Ich habe ein Geschenk für dich.', exampleEn: 'I have a gift for you.', topic: 'Social' },
        { word: 'einkaufen', translation: 'to go shopping', type: 'verb', example: 'Wir gehen heute im Supermarkt einkaufen.', exampleEn: 'We are going shopping at the supermarket today.', topic: 'Daily Life' },
        { word: 'der Nachbar', translation: 'neighbor', type: 'noun', example: 'Mein Nachbar ist sehr nett.', exampleEn: 'My neighbor is very nice.', topic: 'Social' },
        { word: 'die Zeitung', translation: 'newspaper', type: 'noun', example: 'Er liest morgens die Zeitung.', exampleEn: 'He reads the newspaper in the morning.', topic: 'Media' },
        { word: 'spazieren gehen', translation: 'to go for a walk', type: 'phrase', example: 'Wir gehen im Park spazieren.', exampleEn: 'We are going for a walk in the park.', topic: 'Leisure' },
        { word: 'das Fahrrad', translation: 'bicycle', type: 'noun', example: 'Ich fahre gerne mit dem Fahrrad.', exampleEn: 'I like riding my bicycle.', topic: 'Transport' },
        { word: 'der Regenschirm', translation: 'umbrella', type: 'noun', example: 'Nimm einen Regenschirm mit, es regnet.', exampleEn: 'Take an umbrella, it is raining.', topic: 'Weather' },
        { word: 'die Bäckerei', translation: 'bakery', type: 'noun', example: 'Das Brot aus der Bäckerei schmeckt lecker.', exampleEn: 'The bread from the bakery tastes delicious.', topic: 'Food' },
        { word: 'die Telefonnummer', translation: 'phone number', type: 'noun', example: 'Wie ist deine Telefonnummer?', exampleEn: 'What is your phone number?', topic: 'Communication' },
        { word: 'das Wörterbuch', translation: 'dictionary', type: 'noun', example: 'Ich suche das Wort im Wörterbuch.', exampleEn: 'I look up the word in the dictionary.', topic: 'Learning' },
        { word: 'die Kleidung', translation: 'clothing / clothes', type: 'noun', example: 'Sie kauft neue Kleidung für den Sommer.', exampleEn: 'She buys new clothes for the summer.', topic: 'Shopping' },
        { word: 'das Restaurant', translation: 'restaurant', type: 'noun', example: 'Wir essen heute im Restaurant.', exampleEn: 'We are eating at the restaurant today.', topic: 'Food' },
        { word: 'der Geburtstag', translation: 'birthday', type: 'noun', example: 'Alles Gute zum Geburtstag!', exampleEn: 'Happy birthday!', topic: 'Celebration' },
        { word: 'die Familie', translation: 'family', type: 'noun', example: 'Meine Familie wohnt in Frankfurt.', exampleEn: 'My family lives in Frankfurt.', topic: 'People' },
        { word: 'das Wasser', translation: 'water', type: 'noun', example: 'Ich trinke gerne kaltes Wasser.', exampleEn: 'I like drinking cold water.', topic: 'Food' },
        { word: 'das Zimmer', translation: 'room', type: 'noun', example: 'Mein Zimmer ist hell und ruhig.', exampleEn: 'My room is bright and quiet.', topic: 'Home' },
        { word: 'das Fenster', translation: 'window', type: 'noun', example: 'Bitte öffne das Fenster.', exampleEn: 'Please open the window.', topic: 'Home' }
    ],
    A2: [
        { word: 'der Feierabend', translation: 'end of the working day', type: 'noun', example: 'Schönen Feierabend!', exampleEn: 'Have a nice evening after work!', topic: 'Daily Life' },
        { word: 'zuverlässig', translation: 'reliable / dependable', type: 'adjective', example: 'Mein Kollege ist sehr zuverlässig.', exampleEn: 'My colleague is very reliable.', topic: 'Work' },
        { word: 'sich entscheiden', translation: 'to make a decision', type: 'verb', example: 'Ich kann mich noch nicht entscheiden.', exampleEn: 'I cannot decide yet.', topic: 'General' },
        { word: 'die Verabredung', translation: 'appointment / date', type: 'noun', example: 'Ich habe heute eine Verabredung.', exampleEn: 'I have an appointment today.', topic: 'Social' },
        { word: 'die Erfahrung', translation: 'experience', type: 'noun', example: 'Das war eine wunderbare Erfahrung.', exampleEn: 'That was a wonderful experience.', topic: 'Life' },
        { word: 'sich beeilen', translation: 'to hurry', type: 'verb', example: 'Wir müssen uns beeilen, der Zug kommt!', exampleEn: 'We have to hurry, the train is coming!', topic: 'Travel' },
        { word: 'die Werkstatt', translation: 'workshop / garage', type: 'noun', example: 'Mein Auto steht in der Werkstatt.', exampleEn: 'My car is in the garage.', topic: 'Daily Life' },
        { word: 'der Vorschlag', translation: 'suggestion / proposal', type: 'noun', example: 'Das ist ein ausgezeichneter Vorschlag.', exampleEn: 'That is an excellent proposal.', topic: 'Work' },
        { word: 'die Gesundheit', translation: 'health', type: 'noun', example: 'Gesundheit ist das Wichtigste im Leben.', exampleEn: 'Health is the most important thing in life.', topic: 'Wellbeing' },
        { word: 'teilnehmen', translation: 'to participate / attend', type: 'verb', example: 'Möchtest du am Deutschkurs teilnehmen?', exampleEn: 'Would you like to attend the German course?', topic: 'Learning' },
        { word: 'sich beschweren', translation: 'to complain', type: 'verb', example: 'Der Gast beschwert sich über das Essen.', exampleEn: 'The guest is complaining about the food.', topic: 'Service' },
        { word: 'die Umgebung', translation: 'surroundings / neighborhood', type: 'noun', example: 'Die Umgebung hier ist sehr ruhig.', exampleEn: 'The surroundings here are very quiet.', topic: 'Places' },
        { word: 'der Stau', translation: 'traffic jam', type: 'noun', example: 'Wir stehen seit einer Stunde im Stau.', exampleEn: 'We have been stuck in a traffic jam for an hour.', topic: 'Transport' },
        { word: 'der Vorteil', translation: 'advantage / benefit', type: 'noun', example: 'Online lernen hat viele Vorteile.', exampleEn: 'Learning online has many advantages.', topic: 'General' },
        { word: 'das Erlebnis', translation: 'memorable experience / adventure', type: 'noun', example: 'Die Reise nach Berlin war ein tolles Erlebnis.', exampleEn: 'The trip to Berlin was a great experience.', topic: 'Travel' },
        { word: 'der Nachteil', translation: 'disadvantage / downside', type: 'noun', example: 'Ein Nachteil ist der hohe Preis.', exampleEn: 'One disadvantage is the high price.', topic: 'General' },
        { word: 'die Überweisung', translation: 'bank transfer / referral', type: 'noun', example: 'Ich habe die Überweisung heute gemacht.', exampleEn: 'I made the bank transfer today.', topic: 'Finance' },
        { word: 'empfehlen', translation: 'to recommend', type: 'verb', example: 'Welches Buch kannst du mir empfehlen?', exampleEn: 'Which book can you recommend to me?', topic: 'Leisure' },
        { word: 'der Termin', translation: 'appointment', type: 'noun', example: 'Ich muss meinen Termin beim Arzt verschieben.', exampleEn: 'I have to reschedule my doctor appointment.', topic: 'Health' },
        { word: 'die Ausbildung', translation: 'vocational training / education', type: 'noun', example: 'Er macht eine Ausbildung zum Mechatroniker.', exampleEn: 'He is doing vocational training as a mechatronics engineer.', topic: 'Career' },
        { word: 'die Erlaubnis', translation: 'permission', type: 'noun', example: 'Dafür brauchst du eine offizielle Erlaubnis.', exampleEn: 'For that you need official permission.', topic: 'Formal' },
        { word: 'anstrengend', translation: 'exhausting / strenuous', type: 'adjective', example: 'Der heutige Arbeitstag war sehr anstrengend.', exampleEn: 'Today’s working day was very exhausting.', topic: 'Work' },
        { word: 'die Speisekarte', translation: 'menu', type: 'noun', example: 'Können wir bitte die Speisekarte haben?', exampleEn: 'Could we please have the menu?', topic: 'Restaurant' },
        { word: 'der Flughafen', translation: 'airport', type: 'noun', example: 'Wie kommen wir am schnellsten zum Flughafen?', exampleEn: 'How do we get to the airport the fastest?', topic: 'Travel' },
        { word: 'vermissen', translation: 'to miss (someone / something)', type: 'verb', example: 'Ich vermisse meine Heimatstadt.', exampleEn: 'I miss my hometown.', topic: 'Feelings' }
    ],
    B1: [
        { word: 'begeistert', translation: 'enthusiastic / thrilled', type: 'adjective', example: 'Ich bin von der Idee begeistert.', exampleEn: 'I am thrilled with the idea.', topic: 'Emotions' },
        { word: 'der Fortschritt', translation: 'progress / advancement', type: 'noun', example: 'Du machst große Fortschritte auf Deutsch.', exampleEn: 'You are making great progress in German.', topic: 'Learning' },
        { word: 'überwinden', translation: 'to overcome', type: 'verb', example: 'Er hat seine Angst überwunden.', exampleEn: 'He overcame his fear.', topic: 'General' },
        { word: 'die Herausforderung', translation: 'challenge', type: 'noun', example: 'Das ist eine spannende Herausforderung.', exampleEn: 'That is an exciting challenge.', topic: 'Work' },
        { word: 'sich gewöhnen an', translation: 'to get used to', type: 'phrase', example: 'Ich habe mich an das Wetter gewöhnt.', exampleEn: 'I have gotten used to the weather.', topic: 'Life' },
        { word: 'die Gelegenheit', translation: 'opportunity', type: 'noun', example: 'Nutze diese einmalige Gelegenheit!', exampleEn: 'Take advantage of this unique opportunity!', topic: 'General' },
        { word: 'verantwortlich', translation: 'responsible', type: 'adjective', example: 'Wer ist für dieses Projekt verantwortlich?', exampleEn: 'Who is responsible for this project?', topic: 'Work' },
        { word: 'die Unterstützung', translation: 'support / assistance', type: 'noun', example: 'Vielen Dank für deine tatkräftige Unterstützung.', exampleEn: 'Thank you very much for your active support.', topic: 'Work' },
        { word: 'beurteilen', translation: 'to assess / evaluate', type: 'verb', example: 'Es ist schwierig, die Situation zu beurteilen.', exampleEn: 'It is difficult to assess the situation.', topic: 'Work' },
        { word: 'der Eindruck', translation: 'impression', type: 'noun', example: 'Sie hat einen sehr guten Eindruck hinterlassen.', exampleEn: 'She left a very good impression.', topic: 'Social' },
        { word: 'die Enttäuschung', translation: 'disappointment', type: 'noun', example: 'Das Ergebnis war leider eine Enttäuschung.', exampleEn: 'The result was unfortunately a disappointment.', topic: 'Emotions' },
        { word: 'abwechslungsreich', translation: 'varied / diverse', type: 'adjective', example: 'Mein neuer Job ist sehr abwechslungsreich.', exampleEn: 'My new job is very varied.', topic: 'Work' },
        { word: 'die Geduld', translation: 'patience', type: 'noun', example: 'Beim Sprachenlernen braucht man viel Geduld.', exampleEn: 'When learning languages you need a lot of patience.', topic: 'Mindset' },
        { word: 'das Missverständnis', translation: 'misunderstanding', type: 'noun', example: 'Das war nur ein kleines Missverständnis.', exampleEn: 'That was only a small misunderstanding.', topic: 'Communication' },
        { word: 'sich engagieren', translation: 'to get involved / commit to', type: 'verb', example: 'Er engagiert sich für den Umweltschutz.', exampleEn: 'He is committed to environmental protection.', topic: 'Society' },
        { word: 'die Voraussetzung', translation: 'requirement / prerequisite', type: 'noun', example: 'Gute Deutschkenntnisse sind eine wichtige Voraussetzung.', exampleEn: 'Good German skills are an important requirement.', topic: 'Career' },
        { word: 'das Vorstellungsgespräch', translation: 'job interview', type: 'noun', example: 'Ich bereite mich gründlich auf das Vorstellungsgespräch vor.', exampleEn: 'I am preparing thoroughly for the job interview.', topic: 'Career' },
        { word: 'die Verhandlung', translation: 'negotiation', type: 'noun', example: 'Die Verhandlungen verliefen sehr erfolgreich.', exampleEn: 'The negotiations went very successfully.', topic: 'Business' },
        { word: 'vermeiden', translation: 'to avoid / prevent', type: 'verb', example: 'Wir sollten unnötige Fehler unbedingt vermeiden.', exampleEn: 'We should definitely avoid unnecessary mistakes.', topic: 'General' },
        { word: 'die Lösung', translation: 'solution', type: 'noun', example: 'Wir müssen eine gemeinsame Lösung finden.', exampleEn: 'We have to find a joint solution.', topic: 'Problem Solving' },
        { word: 'das Selbstvertrauen', translation: 'self-confidence', type: 'noun', example: 'Erfolge stärken das Selbstvertrauen.', exampleEn: 'Successes strengthen self-confidence.', topic: 'Psychology' },
        { word: 'die Veranstaltung', translation: 'event / function', type: 'noun', example: 'Die kulturelle Veranstaltung war gut besucht.', exampleEn: 'The cultural event was well attended.', topic: 'Culture' },
        { word: 'berücksichtigen', translation: 'to take into account / consider', type: 'verb', example: 'Wir müssen alle Wünsche berücksichtigen.', exampleEn: 'We must consider all wishes.', topic: 'Work' },
        { word: 'die Leidenschaft', translation: 'passion', type: 'noun', example: 'Musik ist ihre größte Leidenschaft.', exampleEn: 'Music is her greatest passion.', topic: 'Life' },
        { word: 'überzeugen', translation: 'to convince / persuade', type: 'verb', example: 'Seine Argumente haben mich überzeugt.', exampleEn: 'His arguments convinced me.', topic: 'Debate' }
    ],
    B2: [
        { word: 'die Sehnsucht', translation: 'yearning / longing', type: 'noun', example: 'Sie hat große Sehnsucht nach den Bergen.', exampleEn: 'She has a great longing for the mountains.', topic: 'Emotions' },
        { word: 'hinterfragen', translation: 'to scrutinize / question', type: 'verb', example: 'Man sollte diese Behauptung kritisch hinterfragen.', exampleEn: 'One should scrutinize this claim critically.', topic: 'Academic' },
        { word: 'nachvollziehbar', translation: 'comprehensible / understandable', type: 'adjective', example: 'Deine Entscheidung ist absolut nachvollziehbar.', exampleEn: 'Your decision is completely understandable.', topic: 'Communication' },
        { word: 'die Auswirkung', translation: 'impact / effect', type: 'noun', example: 'Die Reform hat spürbare Auswirkungen.', exampleEn: 'The reform has noticeable impacts.', topic: 'Society' },
        { word: 'im Voraus', translation: 'in advance', type: 'phrase', example: 'Ich danke Ihnen im Voraus für Ihre Mühe.', exampleEn: 'I thank you in advance for your effort.', topic: 'Formal' },
        { word: 'bewältigen', translation: 'to cope with / manage', type: 'verb', example: 'Gemeinsam können wir diese Krise bewältigen.', exampleEn: 'Together we can manage this crisis.', topic: 'General' },
        { word: 'die Schlussfolgerung', translation: 'conclusion / deduction', type: 'noun', example: 'Welche Schlussfolgerung ziehst du daraus?', exampleEn: 'What conclusion do you draw from this?', topic: 'Academic' },
        { word: 'aufschlussreich', translation: 'insightful / revealing', type: 'adjective', example: 'Das war ein äußerst aufschlussreiches Gespräch.', exampleEn: 'That was an extremely insightful conversation.', topic: 'Professional' },
        { word: 'der Widerspruch', translation: 'contradiction / opposition', type: 'noun', example: 'Seine Taten stehen im Widerspruch zu seinen Worten.', exampleEn: 'His actions contradict his words.', topic: 'Debate' },
        { word: 'in Kauf nehmen', translation: 'to accept / put up with (a drawback)', type: 'phrase', example: 'Für diesen Erfolg müssen wir Risiken in Kauf nehmen.', exampleEn: 'For this success we have to accept risks.', topic: 'Business' },
        { word: 'die Maßnahme', translation: 'measure / action', type: 'noun', example: 'Es wurden strenge Maßnahmen ergriffen.', exampleEn: 'Strict measures were taken.', topic: 'Politics' },
        { word: 'ausschlaggebend', translation: 'decisive / crucial', type: 'adjective', example: 'Seine Erfahrung war der ausschlaggebende Faktor.', exampleEn: 'His experience was the decisive factor.', topic: 'Professional' },
        { word: 'die Nachhaltigkeit', translation: 'sustainability', type: 'noun', example: 'Nachhaltigkeit spielt in unserer Firma eine zentrale Rolle.', exampleEn: 'Sustainability plays a central role in our company.', topic: 'Environment' },
        { word: 'der Stellenwert', translation: 'importance / significance', type: 'noun', example: 'Bildung hat einen hohen Stellenwert.', exampleEn: 'Education has a high level of importance.', topic: 'Society' },
        { word: 'das Feingefühl', translation: 'tact / sensitivity', type: 'noun', example: 'In dieser heiklen Situation braucht man Feingefühl.', exampleEn: 'In this delicate situation one needs tact.', topic: 'Psychology' },
        { word: 'die Veranschaulichung', translation: 'illustration / visualization', type: 'noun', example: 'Zur besseren Veranschaulichung dient diese Grafik.', exampleEn: 'This chart serves for better illustration.', topic: 'Academic' },
        { word: 'beeinträchtigen', translation: 'to impair / compromise', type: 'verb', example: 'Lärm kann die Konzentration stark beeinträchtigen.', exampleEn: 'Noise can severely impair concentration.', topic: 'Health' },
        { word: 'auf den Punkt bringen', translation: 'to get straight to the point / summarize succinctly', type: 'phrase', example: 'Sie hat das Problem präzise auf den Punkt gebracht.', exampleEn: 'She got straight to the point of the problem.', topic: 'Communication' },
        { word: 'die Prognose', translation: 'forecast / projection', type: 'noun', example: 'Die wirtschaftliche Prognose fällt positiv aus.', exampleEn: 'The economic forecast turns out positive.', topic: 'Economy' },
        { word: 'zugrunde liegen', translation: 'to form the basis of / underlie', type: 'phrase', example: 'Dem Phänomen liegen komplexe Ursachen zugrunde.', exampleEn: 'Complex causes underlie the phenomenon.', topic: 'Academic' },
        { word: 'die Verpflichtung', translation: 'obligation / commitment', type: 'noun', example: 'Wir müssen unseren vertraglichen Verpflichtungen nachkommen.', exampleEn: 'We must honor our contractual obligations.', topic: 'Legal' },
        { word: 'der Blickwinkel', translation: 'perspective / point of view', type: 'noun', example: 'Betrachten wir die Lage aus einem anderen Blickwinkel.', exampleEn: 'Let us view the situation from another perspective.', topic: 'Debate' },
        { word: 'maßgeblich', translation: 'authoritative / significantly', type: 'adjective', example: 'Sie hat maßgeblich zum Erfolg des Projekts beigetragen.', exampleEn: 'She contributed significantly to the project’s success.', topic: 'Professional' },
        { word: 'der Konsens', translation: 'consensus', type: 'noun', example: 'Nach langen Debatten erzielten sie einen Konsens.', exampleEn: 'After long debates they reached a consensus.', topic: 'Politics' },
        { word: 'handhaben', translation: 'to handle / manage', type: 'verb', example: 'Dieses Werkzeug lässt sich intuitiv handhaben.', exampleEn: 'This tool can be handled intuitively.', topic: 'Practical' }
    ],
    C1: [
        { word: 'die Errungenschaft', translation: 'achievement / accomplishment', type: 'noun', example: 'Das ist eine bemerkenswerte wissenschaftliche Errungenschaft.', exampleEn: 'That is a remarkable scientific achievement.', topic: 'Academic' },
        { word: 'in Erwägung ziehen', translation: 'to take into consideration', type: 'phrase', example: 'Wir müssen alle Handlungsoptionen in Erwägung ziehen.', exampleEn: 'We must take all options into consideration.', topic: 'Professional' },
        { word: 'unerlässlich', translation: 'indispensable / essential', type: 'adjective', example: 'Gründliche Vorbereitung ist für den Erfolg unerlässlich.', exampleEn: 'Thorough preparation is indispensable for success.', topic: 'Formal' },
        { word: 'gewährleisten', translation: 'to ensure / guarantee', type: 'verb', example: 'Die Einhaltung der Sicherheitsstandards muss gewährleistet sein.', exampleEn: 'Compliance with safety standards must be guaranteed.', topic: 'Formal' },
        { word: 'die Weichen stellen', translation: 'to set the course for', type: 'phrase', example: 'Damit wurden die Weichen für die Zukunft gestellt.', exampleEn: 'This set the course for the future.', topic: 'Politics' },
        { word: 'plausibel', translation: 'plausible / reasonable', type: 'adjective', example: 'Diese Erklärung klingt durchaus plausibel.', exampleEn: 'This explanation sounds completely plausible.', topic: 'Academic' },
        { word: 'der Sachverhalt', translation: 'state of affairs / factual context', type: 'noun', example: 'Der Jurist analysierte den komplexen Sachverhalt.', exampleEn: 'The lawyer analyzed the complex state of affairs.', topic: 'Legal' },
        { word: 'zur Geltung kommen', translation: 'to come into its own / be showcased', type: 'phrase', example: 'Ihre Talente kommen in dieser Position voll zur Geltung.', exampleEn: 'Her talents come fully into their own in this position.', topic: 'Professional' },
        { word: 'unabdingbar', translation: 'imperative / indispensable', type: 'adjective', example: 'Absolute Diskretion ist für uns unabdingbar.', exampleEn: 'Absolute discretion is imperative for us.', topic: 'Professional' },
        { word: 'der Paradigmenwechsel', translation: 'paradigm shift', type: 'noun', example: 'Die Digitalisierung bewirkt einen tiefgreifenden Paradigmenwechsel.', exampleEn: 'Digitalization is bringing about a profound paradigm shift.', topic: 'Academic' },
        { word: 'die Quintessenz', translation: 'the quintessence / core takeaway', type: 'noun', example: 'Die Quintessenz des Berichts ist eindeutig.', exampleEn: 'The core takeaway of the report is clear.', topic: 'Academic' },
        { word: 'facettenreich', translation: 'multifaceted / rich in nuance', type: 'adjective', example: 'Sie lieferte eine facettenreiche Analyse des Themas.', exampleEn: 'She delivered a multifaceted analysis of the topic.', topic: 'Academic' },
        { word: 'der Handlungsspielraum', translation: 'scope for action / maneuvering room', type: 'noun', example: 'Das Budget schränkt unseren Handlungsspielraum ein.', exampleEn: 'The budget restricts our scope for action.', topic: 'Business' },
        { word: 'das Alleinstellungsmerkmal', translation: 'unique selling proposition (USP)', type: 'noun', example: 'Hohe Qualität ist unser Alleinstellungsmerkmal.', exampleEn: 'High quality is our unique selling point.', topic: 'Business' },
        { word: 'fundiert', translation: 'well-founded / sound', type: 'adjective', example: 'Er traf eine wissenschaftlich fundierte Entscheidung.', exampleEn: 'He made a scientifically sound decision.', topic: 'Academic' },
        { word: 'der Denkanstoß', translation: 'food for thought / impulse', type: 'noun', example: 'Der Vortrag lieferte wertvolle Denkanstöße.', exampleEn: 'The lecture provided valuable food for thought.', topic: 'Academic' },
        { word: 'widerspiegeln', translation: 'to reflect / mirror', type: 'verb', example: 'Die Wahlergebnisse spiegeln die Stimmung der Bevölkerung wider.', exampleEn: 'The election results mirror the public mood.', topic: 'Politics' },
        { word: 'auf den Grund gehen', translation: 'to get to the bottom of', type: 'phrase', example: 'Wir müssen den Ursachen des Problems auf den Grund gehen.', exampleEn: 'We have to get to the bottom of the causes of the problem.', topic: 'Research' },
        { word: 'ins Gewicht fallen', translation: 'to carry significant weight / matter', type: 'phrase', example: 'Dieser Kostenfaktor fällt stark ins Gewicht.', exampleEn: 'This cost factor carries significant weight.', topic: 'Economy' },
        { word: 'an den Tag legen', translation: 'to display / exhibit (a behavior)', type: 'phrase', example: 'Er legte beachtliche Disziplin an den Tag.', exampleEn: 'He exhibited remarkable discipline.', topic: 'Professional' },
        { word: 'die Gratwanderung', translation: 'balancing act / tightrope walk', type: 'noun', example: 'Die Diplomatie erfordert oft eine heikle Gratwanderung.', exampleEn: 'Diplomacy often requires a delicate balancing act.', topic: 'Politics' },
        { word: 'herbeiführen', translation: 'to bring about / cause', type: 'verb', example: 'Neue Gesetze sollen eine Wende herbeiführen.', exampleEn: 'New laws are intended to bring about a turnaround.', topic: 'Politics' },
        { word: 'unvoreingenommen', translation: 'unbiased / impartial', type: 'adjective', example: 'Ein Richter muss stets unvoreingenommen urteilen.', exampleEn: 'A judge must always judge impartially.', topic: 'Legal' },
        { word: 'das Augenmerk richten auf', translation: 'to direct one’s focus / attention toward', type: 'phrase', example: 'Wir müssen unser Augenmerk auf die Qualitätskontrolle richten.', exampleEn: 'We must direct our attention toward quality control.', topic: 'Management' },
        { word: 'unter Beweis stellen', translation: 'to demonstrate / prove', type: 'phrase', example: 'Das Team stellte seine Kompetenz eindrucksvoll unter Beweis.', exampleEn: 'The team impressively demonstrated its competence.', topic: 'Professional' }
    ]
};

// CEFR Level Prompt Specifications for the Local AI Model
const CEFR_PROMPT_GUIDELINES = {
    A1: 'CEFR A1 (Beginner): Everyday foundational vocabulary (nouns with der/die/das, basic verbs, food, objects). Example sentence MUST be simple Present Tense (Präsens) under 8 words.',
    A2: 'CEFR A2 (Elementary): Practical daily routines, separable verbs, modal verbs, past tense (Perfekt with haben/sein), health, travel. Example sentence in simple Perfekt or Präsens with weil/dass.',
    B1: 'CEFR B1 (Intermediate): Practical intermediate vocabulary, connective adverbs (deshalb, trotzdem, obwohl), subordinate clauses, reflexive verbs, workplace, feelings, opinions, idioms.',
    B2: 'CEFR B2 (Upper Intermediate): Advanced professional vocabulary, abstract concepts, formal connectors, passive voice, Konjunktiv II, multi-clause structures.',
    C1: 'CEFR C1 (Advanced Fluency): High-register academic/literary terminology, complex nominal phrases (Nominalstil), functional verb phrases (Funktionsverbgefüge like "in Erwägung ziehen", "zur Geltung kommen"), sophisticated rhetoric.'
};

const RANDOM_SEED_TOPICS = [
    'everyday conversations and relationships',
    'culinary culture, food and restaurants',
    'travel, transportation and city exploration',
    'career, job interviews and modern workplace',
    'feelings, psychology and personality',
    'nature, sustainability and technology',
    'leisure activities, arts and entertainment',
    'idiomatic expressions and German proverbs',
    'media, digital life and communication',
    'health, fitness and medical appointments'
];

// Helper: Ask local Ollama LLM to generate fresh CEFR vocabulary cards (up to 20 words)
async function generateVocabWithLLM(level = 'A2', topic = '', existingWords = [], model = DEFAULT_MODEL, requestedCount = 20) {
    const cefrGuide = CEFR_PROMPT_GUIDELINES[level] || CEFR_PROMPT_GUIDELINES.A2;
    const randomTopic = RANDOM_SEED_TOPICS[Math.floor(Math.random() * RANDOM_SEED_TOPICS.length)];
    const topicPrompt = topic ? `focused specifically on "${topic}"` : `covering diverse topics (${randomTopic})`;
    const excludeList = existingWords.slice(-40).join(', ');

    const prompt = `You are a certified Goethe-Institut German instructor.
Strictly adhere to the ${level} CEFR linguistic standards:
${cefrGuide}

Generate ${requestedCount} brand-new, practical German vocabulary words or idiomatic expressions ${topicPrompt}.
Do NOT use any of these known words: [${excludeList}].

Return ONLY a valid JSON array of objects with NO markdown formatting around it:
[{"word":"<German word with der/die/das for nouns>","translation":"<English translation>","type":"noun/verb/adjective/phrase","example":"<German example strictly at ${level} level>","exampleEn":"<English translation of example>"}]`;

    try {
        const result = await callOllama(model, [{ role: 'user', content: prompt }], {
            options: { num_predict: 1200, temperature: 0.85 }
        });
        
        let parsed = null;
        const cleanContent = (result.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        try {
            parsed = JSON.parse(cleanContent);
        } catch (e) {
            const m = cleanContent.match(/\[[\s\S]*\]/);
            if (m) parsed = JSON.parse(m[0]);
            else {
                const objMatch = cleanContent.match(/\{[\s\S]*\}/);
                if (objMatch) {
                    const obj = JSON.parse(objMatch[0]);
                    parsed = obj.words || obj.vocabulary || obj.items || [obj];
                }
            }
        }

        if (Array.isArray(parsed) && parsed.length > 0) {
            const valid = parsed.filter(item => item && item.word && item.translation);
            if (valid.length > 0) return valid;
        }
    } catch (err) {
        console.warn('[vocab] LLM dynamic vocab generation warning:', err.message);
    }

    // Dynamic pool fallback filtered by non-existing words
    const pool = EXPANDED_FALLBACKS[level] || EXPANDED_FALLBACKS.A2;
    const knownSet = new Set(existingWords.map(w => w.toLowerCase().trim()));
    const unlearned = pool.filter(w => !knownSet.has(w.word.toLowerCase().trim()));
    const finalPool = unlearned.length >= 5 ? unlearned : pool;
    const shuffled = [...finalPool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, requestedCount);
}

// GET /api/vocabulary — dynamically fetched & generated vocabulary due for review or drill
router.get('/', async (req, res) => {
    try {
        const { userId, level, mode = 'due', forceNew } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const userLevel = level || 'A2';
        let user = await User.findOne({ userId });
        if (!user) user = await User.create({ userId, username: 'Learner', currentLevel: userLevel });

        const targetModel = user.selectedModel || DEFAULT_MODEL;
        const now = new Date();

        let userCards = [];

        if (mode === 'mistakes') {
            userCards = await Vocabulary.find({
                userId,
                level: userLevel,
                $or: [
                    { incorrectCount: { $gt: 0 } },
                    { srsStage: 1 }
                ]
            }).sort({ incorrectCount: -1, lastReviewedAt: -1 }).limit(20).lean();
        } else if (mode === 'all') {
            userCards = await Vocabulary.find({ userId, level: userLevel })
                .sort({ srsStage: 1, lastReviewedAt: 1 })
                .limit(20)
                .lean();
        } else {
            // Due cards for this specific level
            userCards = await Vocabulary.find({
                userId,
                level: userLevel,
                nextReviewDate: { $lte: now }
            }).sort({ nextReviewDate: 1 }).limit(20).lean();

            // If user has 0 due cards for this level, check existing unreviewed cards for this level
            if (userCards.length === 0) {
                userCards = await Vocabulary.find({ userId, level: userLevel })
                    .sort({ srsStage: 1, lastReviewedAt: 1 })
                    .limit(20)
                    .lean();
            }
        }

        // CONNECT VOCABULARY SRS MODULE DIRECTLY TO THE 15,000-WORD VOCABULARY BANK:
        // When cards for this level are fewer than 20, draw fresh, unlearned words from VocabBank!
        if (userCards.length < 20) {
            const needed = 20 - userCards.length;
            const bankLevel = ['A1', 'A2', 'B1'].includes(userLevel) ? userLevel : 'B1';

            // Find all words already in user's vocabulary to prevent any duplication
            const allUserWords = await Vocabulary.find({ userId }).select('word').lean();
            const knownSet = new Set(allUserWords.map(w => w.word.toLowerCase().trim()));

            try {
                const bankSample = await VocabBank.aggregate([
                    { $match: { level: bankLevel } },
                    { $sample: { size: Math.max(needed * 3, 50) } }
                ]);

                for (const item of bankSample) {
                    if (userCards.length >= 20) break;
                    const wClean = item.word.toLowerCase().trim();
                    if (knownSet.has(wClean)) continue;

                    const newVocab = await Vocabulary.create({
                        userId,
                        word: item.word,
                        translation: item.translation,
                        example: item.example || '',
                        level: userLevel,
                        srsStage: 1,
                        nextReviewDate: new Date(),
                        addedFrom: 'manual',
                        sourceText: item.exampleEn || item.topic || '15k Vocab Bank'
                    });
                    knownSet.add(wClean);
                    userCards.push(newVocab.toObject ? newVocab.toObject() : newVocab);
                }
            } catch (bankErr) {
                console.warn('[vocab] Bank auto-fill notice:', bankErr.message);
            }
        }

        // Deduplicate cards by ID
        const seenIds = new Set();
        const uniqueCards = userCards.filter(c => {
            const idStr = c._id.toString();
            if (seenIds.has(idStr)) return false;
            seenIds.add(idStr);
            return true;
        });

        // Format for frontend
        const words = uniqueCards.map(v => ({
            id: v._id.toString(),
            de: v.word,
            en: v.translation,
            type: v.sourceText?.includes('noun') ? 'noun' : v.sourceText?.includes('verb') ? 'verb' : 'word',
            example: v.example || '',
            exampleEn: v.sourceText || '',
            level: v.level || userLevel,
            source: 'user',
            srsStage: v.srsStage || 1,
            incorrectCount: v.incorrectCount || 0,
            correctCount: v.correctCount || 0
        }));

        // Calculate real SRS stage distribution across all user vocabulary
        const srsDistribution = { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0 };
        const allUserVocab = await Vocabulary.find({ userId }).lean();
        allUserVocab.forEach(v => {
            const st = `stage${Math.min(5, Math.max(1, v.srsStage || 1))}`;
            srsDistribution[st] = (srsDistribution[st] || 0) + 1;
        });

        const mistakesCount = allUserVocab.filter(v => (v.incorrectCount || 0) > 0 || (v.srsStage || 1) === 1).length;

        res.json({
            words,
            dueCount: words.length,
            total: allUserVocab.length,
            mistakesCount,
            mode,
            level: userLevel,
            srsDistribution
        });

    } catch (err) {
        console.error('[vocab] Error:', err.message);
        res.status(500).json({ error: 'Failed to load vocabulary: ' + err.message });
    }
});

// POST /api/vocabulary/generate-pack — ALWAYS generate 20 BRAND-NEW, NEVER-SEEN-BEFORE words
router.post('/generate-pack', async (req, res) => {
    try {
        const { userId, level, topic, count } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const targetCount = parseInt(count, 10) || 20;
        const user = await User.findOne({ userId });
        const userLevel = level || user?.currentLevel || 'A2';
        const targetModel = user?.selectedModel || DEFAULT_MODEL;

        // Fetch ALL words the user already knows to guarantee zero repetition
        const allKnown = await Vocabulary.find({ userId }).select('word').lean();
        const knownWords = allKnown.map(w => w.word);
        const knownSet = new Set(knownWords.map(w => w.toLowerCase().trim()));

        const resultCards = [];

        // 1. Draw directly from 15,000-Word VocabBank for the target CEFR level
        if (['A1', 'A2', 'B1'].includes(userLevel)) {
            const bankQuery = { level: userLevel };
            if (topic && topic.trim()) {
                bankQuery.$or = [
                    { topic: new RegExp(topic.trim(), 'i') },
                    { word: new RegExp(topic.trim(), 'i') },
                    { translation: new RegExp(topic.trim(), 'i') }
                ];
            }

            const bankMatches = await VocabBank.aggregate([
                { $match: bankQuery },
                { $sample: { size: targetCount * 3 } }
            ]);

            for (const item of bankMatches) {
                if (resultCards.length >= targetCount) break;
                const wClean = item.word.toLowerCase().trim();
                if (knownSet.has(wClean)) continue;

                const newVocab = await Vocabulary.create({
                    userId,
                    word: item.word,
                    translation: item.translation,
                    example: item.example || '',
                    level: userLevel,
                    srsStage: 1,
                    nextReviewDate: new Date(),
                    addedFrom: 'manual',
                    sourceText: item.exampleEn || item.topic || topic || '15k Vocab Bank'
                });
                knownSet.add(wClean);

                resultCards.push({
                    id: newVocab._id.toString(),
                    de: newVocab.word,
                    en: newVocab.translation,
                    type: item.type || 'word',
                    example: newVocab.example || '',
                    exampleEn: newVocab.sourceText || '',
                    level: newVocab.level || userLevel,
                    source: 'user',
                    srsStage: 1,
                    incorrectCount: 0,
                    correctCount: 0
                });
            }
        }

        // 2. If more words needed (e.g. for C1/B2 or specific niche topic), call local AI
        if (resultCards.length < targetCount) {
            const generated = await generateVocabWithLLM(userLevel, topic || '', [...knownSet], targetModel, targetCount - resultCards.length);
            for (const item of generated) {
                if (resultCards.length >= targetCount) break;
                if (!item || !item.word || !item.translation) continue;
                const wordClean = item.word.trim();
                if (knownSet.has(wordClean.toLowerCase())) continue;

                const newVocab = await Vocabulary.create({
                    userId,
                    word: wordClean,
                    translation: item.translation.trim(),
                    example: item.example ? item.example.trim() : '',
                    level: userLevel,
                    srsStage: 1,
                    nextReviewDate: new Date(),
                    addedFrom: 'manual',
                    sourceText: item.exampleEn || item.topic || topic || 'AI Generated'
                });
                knownSet.add(wordClean.toLowerCase());

                resultCards.push({
                    id: newVocab._id.toString(),
                    de: newVocab.word,
                    en: newVocab.translation,
                    type: item.type || 'word',
                    example: newVocab.example || '',
                    exampleEn: newVocab.sourceText || '',
                    level: newVocab.level || userLevel,
                    source: 'user',
                    srsStage: 1,
                    incorrectCount: 0,
                    correctCount: 0
                });
            }
        }

        // If fewer than targetCount words, top up from the 15,000-Word VocabBank
        if (resultCards.length < targetCount) {
            try {
                const bankMatches = await VocabBank.aggregate([
                    { $match: { level: ['A1', 'A2', 'B1'].includes(userLevel) ? userLevel : 'B1' } },
                    { $sample: { size: 60 } }
                ]);

                for (const item of bankMatches) {
                    if (resultCards.length >= targetCount) break;
                    const wClean = item.word.toLowerCase().trim();
                    if (knownSet.has(wClean)) continue;

                    const newVocab = await Vocabulary.create({
                        userId,
                        word: item.word,
                        translation: item.translation,
                        example: item.example || '',
                        level: item.level || userLevel,
                        srsStage: 1,
                        nextReviewDate: new Date(),
                        addedFrom: 'manual',
                        sourceText: item.exampleEn || item.topic || '15k Vocab Bank'
                    });
                    knownSet.add(wClean);

                    resultCards.push({
                        id: newVocab._id.toString(),
                        de: newVocab.word,
                        en: newVocab.translation,
                        type: item.type || 'word',
                        example: newVocab.example || '',
                        exampleEn: newVocab.sourceText || '',
                        level: newVocab.level || userLevel,
                        source: 'user',
                        srsStage: 1,
                        incorrectCount: 0,
                        correctCount: 0
                    });
                }
            } catch (bankErr) {
                console.warn('[vocab] VocabBank top-up notice:', bankErr.message);
            }
        }

        // Additional fallback from EXPANDED_FALLBACKS if still below targetCount
        if (resultCards.length < targetCount) {
            const pool = EXPANDED_FALLBACKS[userLevel] || EXPANDED_FALLBACKS.A2;
            const availableNew = pool.filter(p => !knownSet.has(p.word.toLowerCase().trim()));
            const shuffledPool = [...availableNew].sort(() => 0.5 - Math.random());

            for (const item of shuffledPool) {
                if (resultCards.length >= targetCount) break;
                const newVocab = await Vocabulary.create({
                    userId,
                    word: item.word,
                    translation: item.translation,
                    example: item.example || '',
                    level: userLevel,
                    srsStage: 1,
                    nextReviewDate: new Date(),
                    addedFrom: 'manual',
                    sourceText: item.exampleEn || item.topic || 'Curated CEFR Bank'
                });
                knownSet.add(item.word.toLowerCase().trim());

                resultCards.push({
                    id: newVocab._id.toString(),
                    de: newVocab.word,
                    en: newVocab.translation,
                    type: item.type || 'word',
                    example: newVocab.example || '',
                    exampleEn: newVocab.sourceText || '',
                    level: newVocab.level || userLevel,
                    source: 'user',
                    srsStage: 1,
                    incorrectCount: 0,
                    correctCount: 0
                });
            }
        }

        res.json({
            success: true,
            createdCount: resultCards.length,
            words: resultCards,
            topic: topic || `Fresh CEFR ${userLevel} Pack (${resultCards.length} Words)`
        });

    } catch (err) {
        console.error('[vocab] Generate pack error:', err.message);
        res.status(500).json({ error: 'Failed to generate vocabulary pack: ' + err.message });
    }
});

// POST /api/vocabulary/add — add a word from reading or custom entry
router.post('/add', async (req, res) => {
    try {
        const { userId, word, translation, example, level, addedFrom, sourceText } = req.body;
        if (!userId || !word) {
            return res.status(400).json({ error: 'Missing required fields: userId, word' });
        }

        const exists = await Vocabulary.findOne({ userId, word: { $regex: new RegExp(`^${word.trim()}$`, 'i') } });
        if (exists) {
            return res.json({ success: true, duplicate: true, word: exists });
        }

        const vocab = await Vocabulary.create({
            userId,
            word: word.trim(),
            translation: translation || '',
            example: example || '',
            level: level || 'A2',
            srsStage: 1,
            addedFrom: addedFrom || 'reading',
            sourceText: sourceText || '',
            nextReviewDate: new Date()
        });

        // Update user stats
        const todayStr = new Date().toISOString().split('T')[0];
        let user = await User.findOne({ userId });
        if (user) {
            user.totalWordsLearned = (user.totalWordsLearned || 0) + 1;
            user.xp = (user.xp || 0) + 3;
            user.lastActiveAt = new Date();

            if (!user.studyHistory) user.studyHistory = [];
            let hist = user.studyHistory.find(h => h.date === todayStr);
            if (hist) {
                hist.wordsLearned = (hist.wordsLearned || 0) + 1;
                hist.xp = (hist.xp || 0) + 3;
            } else {
                user.studyHistory.push({ date: todayStr, xp: 3, wordsLearned: 1, messagesSent: 0, essaysGraded: 0, minutesSpent: 1 });
            }
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({ success: true, word: vocab });

    } catch (err) {
        console.error('[vocab] Add error:', err.message);
        res.status(500).json({ error: 'Failed to add word: ' + err.message });
    }
});

// GET /api/vocabulary/mine — all user-added words
router.get('/mine', async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const words = await Vocabulary.find({ userId }).sort({ createdAt: -1 }).lean();
        res.json({ words, total: words.length });

    } catch (err) {
        console.error('[vocab] Mine error:', err.message);
        res.status(500).json({ error: 'Failed to load vocabulary' });
    }
});

// POST /api/vocabulary/rate — record SRS rating (Leitner system)
router.post('/rate', async (req, res) => {
    try {
        const { userId, wordId, rating } = req.body;
        if (!userId || !wordId || !rating) {
            return res.status(400).json({ error: 'Missing required fields: userId, wordId, rating' });
        }

        const correct = (rating === 'good' || rating === 'easy');
        const xpEarned = correct ? 2 : 1;
        const todayStr = new Date().toISOString().split('T')[0];

        const vocab = await Vocabulary.findById(wordId);
        if (!vocab) return res.status(404).json({ error: 'Word not found' });

        const next = leitnerNext(vocab.srsStage || 1, correct);
        vocab.srsStage       = next.srsStage;
        vocab.nextReviewDate = next.nextReviewDate;
        vocab.lastReviewedAt = new Date();
        if (correct) vocab.correctCount++;
        else         vocab.incorrectCount++;
        await vocab.save();

        let user = await User.findOne({ userId });
        if (user) {
            user.xp = (user.xp || 0) + xpEarned;
            if (correct) user.totalWordsLearned = (user.totalWordsLearned || 0) + 1;
            user.lastActiveAt = new Date();

            // Update daily module status
            const dailyStatus = getOrCreateDailyStatus(user, todayStr);
            dailyStatus.vocabCount = (dailyStatus.vocabCount || 0) + 1;
            if (dailyStatus.vocabCount >= 5) {
                dailyStatus.vocabCompleted = true;
            }

            if (!user.studyHistory) user.studyHistory = [];
            let hist = user.studyHistory.find(h => h.date === todayStr);
            if (hist) {
                hist.xp = (hist.xp || 0) + xpEarned;
                if (correct) hist.wordsLearned = (hist.wordsLearned || 0) + 1;
                hist.minutesSpent = (hist.minutesSpent || 0) + 1;
            } else {
                user.studyHistory.push({ date: todayStr, xp: xpEarned, wordsLearned: correct ? 1 : 0, messagesSent: 0, essaysGraded: 0, minutesSpent: 1 });
            }
            user.markModified('dailyModuleStatus');
            user.markModified('studyHistory');
            await checkAndAwardAchievements(user);
            await user.save();
        }

        res.json({ success: true, nextReview: next.nextReviewDate, srsStage: next.srsStage, xpEarned });

    } catch (err) {
        console.error('[vocab] Rate error:', err.message);
        res.status(500).json({ error: 'Failed to save rating: ' + err.message });
    }
});

// GET /api/vocabulary/bank — search & filter the 15,000-word bank
router.get('/bank', async (req, res) => {
    try {
        const { q, level, topic, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const filter = {};
        if (level && ['A1', 'A2', 'B1'].includes(level)) {
            filter.level = level;
        }
        if (topic && topic !== 'All') {
            filter.topic = topic;
        }
        if (q && q.trim()) {
            const regex = new RegExp(q.trim(), 'i');
            filter.$or = [
                { word: regex },
                { translation: regex }
            ];
        }

        const [words, total] = await Promise.all([
            VocabBank.find(filter).sort({ level: 1, word: 1 }).skip(skip).limit(limitNum).lean(),
            VocabBank.countDocuments(filter)
        ]);

        res.json({
            words,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum),
            limit: limitNum
        });
    } catch (err) {
        console.error('[vocab] Bank query error:', err.message);
        res.status(500).json({ error: 'Failed to query vocabulary bank: ' + err.message });
    }
});

// GET /api/vocabulary/bank/stats — return count metrics for the 15k bank
router.get('/bank/stats', async (_req, res) => {
    try {
        const [total, a1, a2, b1] = await Promise.all([
            VocabBank.countDocuments(),
            VocabBank.countDocuments({ level: 'A1' }),
            VocabBank.countDocuments({ level: 'A2' }),
            VocabBank.countDocuments({ level: 'B1' })
        ]);
        res.json({ total, A1: a1, A2: a2, B1: b1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vocabulary/bank/add-to-deck — add word from bank into user's SRS deck
router.post('/bank/add-to-deck', async (req, res) => {
    try {
        const { userId, wordId, word, translation, example, exampleEn, level, type, topic } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        let targetWord = word;
        let targetTrans = translation;
        let targetEx = example;
        let targetExEn = exampleEn;
        let targetLvl = level || 'A2';
        let targetType = type || 'word';

        if (wordId) {
            const bankItem = await VocabBank.findById(wordId);
            if (bankItem) {
                targetWord = bankItem.word;
                targetTrans = bankItem.translation;
                targetEx = bankItem.example;
                targetExEn = bankItem.exampleEn;
                targetLvl = bankItem.level;
                targetType = bankItem.type;
            }
        }

        if (!targetWord) return res.status(400).json({ error: 'Missing word details' });

        // Deduplicate in user's deck
        const exists = await Vocabulary.findOne({
            userId,
            word: { $regex: new RegExp(`^${targetWord.trim()}$`, 'i') }
        });

        if (exists) {
            return res.json({ success: true, alreadyExists: true, word: exists });
        }

        const newVocab = await Vocabulary.create({
            userId,
            word: targetWord.trim(),
            translation: targetTrans || '',
            example: targetEx || '',
            level: targetLvl,
            srsStage: 1,
            nextReviewDate: new Date(),
            addedFrom: 'manual',
            sourceText: targetExEn || topic || '15k Vocab Bank'
        });

        // Award XP
        await User.updateOne({ userId }, { $inc: { totalWordsLearned: 1, xp: 5 } });

        res.json({ success: true, alreadyExists: false, word: newVocab });
    } catch (err) {
        console.error('[vocab] Add to deck error:', err.message);
        res.status(500).json({ error: 'Failed to add word to deck: ' + err.message });
    }
});

export default router;

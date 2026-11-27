"""Column order and types for the data CSVs (see data/SCHEMA.md)."""
SEP = " | "
# (name, type) where type is: str, int, optint (int or empty), bool (yes/no), list (' | ' separated)

# One row per lemma (dictionary headword): um covers um + uma, ter covers tenho + tem.
WORD_FIELDS = [
    ("id", "str"), ("headword", "str"), ("word_type", "str"), ("english", "str"),
    ("part_of_speech", "str"), ("lesson", "int"), ("is_object", "bool"), ("photo", "str"),
    ("photo_credit", "str"), ("scene", "str"), ("root", "str"), ("source_language", "str"),
    ("root_image", "str"), ("definition_pt", "str"), ("literal", "str"), ("parts", "str"),
    ("parts_meaning", "str"), ("origin", "str"), ("history", "list"), ("cognates", "list"),
    ("pt_family", "list"), ("synonyms", "list"), ("antonyms", "list"), ("culture", "list"),
    ("notes", "list"), ("tags", "list"),
]
# One row per form (gender / number / conjugated person) of a lemma.
# Empty content cells inherit from the lemma (scene, definition_pt, photo, root, ...).
FORM_FIELDS = [
    ("id", "str"), ("lemma_id", "str"), ("form", "str"), ("label", "str"), ("gender", "str"),
    ("number", "str"), ("person", "str"), ("tense", "str"), ("taught", "bool"), ("lesson", "optint"),
    ("english", "str"), ("part_of_speech", "str"), ("audio", "str"), ("photo", "str"),
    ("photo_credit", "str"), ("scene", "str"), ("definition_pt", "str"), ("root", "str"),
    ("root_image", "str"), ("literal", "str"), ("parts", "str"), ("parts_meaning", "str"),
    ("origin", "str"), ("notes", "list"), ("accept_also", "list"),
]
# One row per phrase. components: 'surface=lemma_id#form_id' items; '=…' omitted when the word has no page yet.
PHRASE_FIELDS = [
    ("id", "str"), ("phrase", "str"), ("english", "str"), ("part_of_speech", "str"), ("lesson", "int"),
    ("components", "list"), ("audio", "str"), ("photo", "str"), ("photo_credit", "str"),
    ("scene", "str"), ("root", "str"), ("source_language", "str"), ("root_image", "str"),
    ("definition_pt", "str"), ("literal", "str"), ("parts", "str"), ("parts_meaning", "str"),
    ("origin", "str"), ("history", "list"), ("cognates", "list"), ("pt_family", "list"),
    ("synonyms", "list"), ("antonyms", "list"), ("culture", "list"), ("notes", "list"),
    ("accept_also", "list"), ("tags", "list"),
]
SENTENCE_FIELDS = [
    ("id", "str"), ("item_id", "str"), ("sentence_pt", "str"), ("answer", "str"),
    ("sentence_en", "str"), ("accept_also", "list"),
]
# Old practice/progress id -> new item id (form id or phrase id). Used to migrate saved progress.
ID_MAP_FIELDS = [("old_id", "str"), ("new_id", "str"), ("note", "str")]

WORD_TYPES = {
    "animate_noun": "Person", "inanimate_noun": "Thing", "proper_noun": "Place / name",
    "pronoun": "Pronoun", "verb": "Verb", "adjective": "Adjective", "adverb": "Adverb",
    "article": "Article", "number": "Number", "preposition": "Preposition",
    "conjunction": "Conjunction", "interjection": "Interjection", "possessive": "Possessive",
    "question_word": "Question word",
}

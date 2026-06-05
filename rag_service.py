import chromadb
from ollama import embeddings, generate


class RagService:
    def __init__(self):
        self.client = chromadb.PersistentClient(path="./chroma")

        self.collection = self.client.get_or_create_collection(
            name="documents"
        )

    def search(self, query: str, top_k: int = 5):
        query_embedding = embeddings(
            model="nomic-embed-text",
            prompt=query
        )

        results = self.collection.query(
            query_embeddings=[query_embedding["embedding"]],
            n_results=top_k
        )

        return results["documents"][0]

    def ask(self, question: str):
        docs = self.search(question)
        context = "\n\n".join(docs)

        prompt = f"""
Answer only from the supplied context.

Context:
{context}

Question:
{question}
""".strip()

        response = generate(
            model="qwen2.5:7b",
            prompt=prompt
        )

        return response["response"]
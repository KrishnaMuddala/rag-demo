import chromadb
from ollama import embeddings, generate

client = chromadb.PersistentClient(path="./chroma")

collection = client.get_collection("network_docs")

question = input("Question: ")

query_embedding = embeddings(
    model="nomic-embed-text",
    prompt=question
)

results = collection.query(
    query_embeddings=[query_embedding["embedding"]],
    n_results=3
)

context = "\n\n".join(results["documents"][0])

prompt = f"""
Answer using ONLY the context below.

Context:
{context}

Question:
{question}
"""

response = generate(
    model="qwen2.5:7b",
    prompt=prompt
)

print("\nAnswer:")
print(response["response"])
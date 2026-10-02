# Publicação nas lojas

Roteiro para publicar o Lepidox na Chrome Web Store e no Microsoft Edge Add-ons como desenvolvedor individual. O mesmo pacote serve para as duas lojas.

Os requisitos das lojas mudam com frequência. Os números abaixo (taxa, tamanhos, limites) refletem o que valia quando este roteiro foi escrito; confira no painel de cada loja na hora de enviar.

## 1. Gerar o pacote

```sh
npm test
npm run build
```

O arquivo sai em `dist/lepidox-<versão>.zip`. Ele contém só o que a extensão usa em execução: `manifest.json`, `_locales`, `assets/icons`, `src`, `LICENSE` e `NOTICE`.

Antes de enviar, carregue a pasta do repositório em `chrome://extensions` e em `edge://extensions` (modo do desenvolvedor, **Carregar sem compactação**) e faça uma rotação completa em cada navegador.

A cada nova versão, altere `version` em `manifest.json` **e** em `package.json` (o `npm test` acusa se ficarem diferentes) e registre a mudança em `CHANGELOG.md`.

## 2. Material de divulgação

Tudo está em [`store/`](../../store):

| Arquivo | Uso |
| --- | --- |
| `screenshots/en/*.png`, `screenshots/pt_BR/*.png` | Capturas 1280×800, uma série por idioma |
| `promo-small-440x280.png` | Bloco promocional pequeno (Chrome e Edge) |
| `logo-300.png` | Logotipo da loja no Edge (gerado por `npm run icons`) |

O ícone 128×128 da Chrome Web Store já vai dentro do pacote.

Os textos da ficha (descrição, justificativas de permissão, instruções para o revisor) estão em [listing.md](listing.md), em inglês e português.

## 3. Política de privacidade

As duas lojas pedem um endereço público. Use:

`https://github.com/AdrielGTeles/lepidox/blob/main/PRIVACY.md`

O arquivo precisa estar no ramo `main` do repositório público antes do envio.

## 4. Chrome Web Store

1. Crie a conta de desenvolvedor em <https://chrome.google.com/webstore/devconsole>. Há uma taxa única de registro (US$ 5) e a conta Google precisa ter verificação em duas etapas.
2. Em **Conta**, preencha nome do editor e e-mail de contato (o e-mail fica visível na ficha) e verifique o e-mail.
3. Declare a condição de **comerciante ou não comerciante** (exigência da União Europeia). Quem publica um projeto pessoal, sem atividade comercial, declara-se não comerciante. Se a extensão passar a ser parte de um negócio, a declaração muda e exige dados de contato verificados.
4. **Novo item** → envie o zip.
5. **Ficha da loja**: descrição, categoria, idioma, capturas e bloco promocional. Adicione o idioma português (Brasil) e cole os textos correspondentes.
6. **Práticas de privacidade**: finalidade única, justificativa de cada permissão, declaração de que não há código remoto, uso de dados e o endereço da política. Os textos prontos estão em [listing.md](listing.md).
7. **Distribuição**: público, todas as regiões, gratuito.
8. **Instruções de teste**: cole o roteiro de [listing.md](listing.md).
9. Envie para revisão. A permissão `tabs` costuma levar a uma análise mais demorada; a justificativa detalhada ajuda.

## 5. Microsoft Edge Add-ons

1. Cadastre-se como desenvolvedor individual no Partner Center: <https://partner.microsoft.com/dashboard/microsoftedge/public/login>. O cadastro para extensões do Edge não tem custo.
2. **Criar nova extensão** → envie o mesmo zip.
3. **Disponibilidade**: pública, todos os mercados.
4. **Propriedades**: categoria, endereço da política de privacidade, site e contato de suporte.
5. **Fichas da loja**: uma por idioma (inglês e português do Brasil). Descrição, logotipo 300×300, bloco promocional pequeno, capturas e termos de busca.
6. **Notas para certificação**: cole o roteiro de teste de [listing.md](listing.md).
7. Publique. A certificação pode levar alguns dias úteis.

## 6. Depois de publicado

- Substitua, no `README.md`, o trecho "Store listings are in preparation" pelos endereços das fichas.
- Atualizações seguem o mesmo caminho: nova versão, `npm run build`, envio do zip nas duas lojas.
- Os atalhos sugeridos só valem para instalações novas. Quem já tem a extensão mantém os atalhos que estavam atribuídos.

## Compatibilidade verificada

A versão 1.1.0 foi exercitada de ponta a ponta a partir do pacote gerado, no Microsoft Edge 154 e no Chromium 153 (o motor do Chrome), com a interface em português: criar lista, colar endereços, reordenar, verificar acessos, iniciar, pausar, pular, editar durante a rotação, importar, exportar e encerrar. A interface em inglês foi exercitada no Chromium.

O Google Chrome de marca não aceita carregar extensões por linha de comando, então nele o teste é manual (passo 1). O manifesto exige a versão 120 ou superior.
